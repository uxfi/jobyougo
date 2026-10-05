import test from 'node:test';
import assert from 'node:assert/strict';
import { choiceKind, listFilterText, optionMatchScore, optionsAreYesNo, pickMatchingOption, placeWantedOnYesNoList, selectionLooksCommitted } from '../lib/apply-option-match.mjs';

test('list filter types the short query and only the first word of a long one', () => {
  assert.equal(listFilterText('Bangkok'), 'Bangkok');
  assert.equal(listFilterText('Yes'), '');
  assert.equal(listFilterText('No'), '');
  assert.equal(listFilterText('I have led design systems across several product teams'), 'have');
});

test('Yes|No lists are not a city, and a Location label should take Yes', () => {
  assert.equal(optionsAreYesNo([{ text: 'Yes' }, { text: 'No' }]), true);
  assert.equal(optionsAreYesNo(['Yes', 'No', 'Prefer not to say']), false);
  assert.equal(optionsAreYesNo(['Paris, France', 'Lyon, France']), false);
  assert.equal(placeWantedOnYesNoList('Location', 'Paris, France'), true);
  assert.equal(placeWantedOnYesNoList('How did you hear about this job?', 'LinkedIn'), false);
  assert.equal(placeWantedOnYesNoList('Willing to relocate?', 'Paris, France'), false);
});

test('choiceKind recognizes yes/no literals only', () => {
  assert.equal(choiceKind('Yes'), 'yes');
  assert.equal(choiceKind('oui'), 'yes');
  assert.equal(choiceKind('No'), 'no');
  assert.equal(choiceKind('non'), 'no');
  assert.equal(choiceKind('France'), null);
  assert.equal(choiceKind('None of the above'), null);
});

test('No matches the long sponsorship option, not None / Non-binary', () => {
  const opts = [
    'None of the above',
    'Non-binary',
    "No, I don't require sponsorship",
    'Yes, I require sponsorship',
  ];
  const picked = pickMatchingOption(opts, 'No');
  assert.equal(picked?.text, "No, I don't require sponsorship");
  assert.ok(optionMatchScore('No', "No, I don't require sponsorship") >= 50);
  assert.equal(optionMatchScore('No', 'None of the above'), 0);
  assert.equal(optionMatchScore('No', 'Non-binary'), 0);
});

test('Yes matches the long authorized-to-work option', () => {
  const picked = pickMatchingOption([
    'No',
    'Yes, I am authorized to work in this country',
  ], 'Yes');
  assert.equal(picked?.text, 'Yes, I am authorized to work in this country');
});

test('country aliases: France ↔ French Republic, Thailand ↔ Thaïlande', () => {
  assert.equal(pickMatchingOption(['French Republic', 'Germany'], 'France')?.text, 'French Republic');
  assert.equal(pickMatchingOption(['France', 'Belgium'], 'French Republic')?.text, 'France');
  assert.equal(pickMatchingOption(['Thaïlande', 'France'], 'Thailand')?.text, 'Thaïlande');
  assert.equal(pickMatchingOption(['United States of America', 'United Kingdom'], 'USA')?.text, 'United States of America');
});

test('Austria is not Australia; dial options match +33 / France', () => {
  assert.equal(pickMatchingOption(['Australia +61', 'Austria +43', 'France +33'], 'Austria')?.text, 'Austria +43');
  assert.equal(pickMatchingOption(['Australia +61', 'Austria +43', 'France +33'], '+33')?.text, 'France +33');
  assert.equal(pickMatchingOption(['Australia +61', 'Austria +43', 'France +33'], 'France')?.text, 'France +33');
  assert.notEqual(pickMatchingOption(['Australia +61', 'Austria +43'], 'Austria')?.text, 'Australia +61');
});

test('short country codes do not substring-match unrelated options', () => {
  assert.equal(pickMatchingOption(['Let us know', 'United States'], 'US')?.text, 'United States');
  assert.equal(pickMatchingOption(['From our team', 'France'], 'FR')?.text, 'France');
  assert.equal(pickMatchingOption(['Australia', 'USA'], 'United States')?.text, 'USA');
  assert.equal(pickMatchingOption(['Australia', 'Infrastructure'], 'United States'), null);
  assert.equal(pickMatchingOption(['Australia', 'Infrastructure'], 'France'), null);
});

test('Male does not pick Female via substring', () => {
  assert.equal(pickMatchingOption(['Female', 'Prefer not to say'], 'Male'), null);
  assert.equal(pickMatchingOption(['Male', 'Female'], 'Male')?.text, 'Male');
});

test('pickMatchingOption keeps the original option object', () => {
  const opts = [
    { value: 'no_sponsor', text: "No, I don't require sponsorship" },
    { value: 'none', text: 'None of the above' },
  ];
  const picked = pickMatchingOption(opts, 'No');
  assert.equal(picked?.value, 'no_sponsor');
});

test('dial code +33 matches FR +33 in a country list', () => {
  const picked = pickMatchingOption(['US +1', 'FR +33', 'TH +66', 'DE +49'], '+33');
  assert.equal(picked?.text, 'FR +33');
});

test('typed filter text is not a list selection', () => {
  assert.equal(selectionLooksCommitted({ inputValue: 'Yes', query: 'Yes' }), null);
  assert.equal(selectionLooksCommitted({ inputValue: 'Fra', query: 'France', filterTyped: 'Fra' }), null);
  assert.equal(selectionLooksCommitted({ displayed: 'France', query: 'France' }), 'France');
  assert.equal(selectionLooksCommitted({ buttonText: '2-5 years', query: '2' }), '2-5 years');
  assert.equal(selectionLooksCommitted({ shadowValue: 'opt-12', query: 'France' }), 'opt-12');
  assert.equal(selectionLooksCommitted({
    inputValue: 'France', clickedText: 'France', filterTyped: 'Fra', query: 'France',
  }), 'France');
  assert.equal(selectionLooksCommitted({
    inputValue: 'Paris, France', query: 'Paris', filterTyped: 'Par',
  }), 'Paris, France');
  assert.equal(selectionLooksCommitted({ buttonText: 'Select...', query: 'France' }), null);
});

test('input type=button listbox commits via buttonText from .value (Revolut)', () => {
  assert.equal(
    selectionLooksCommitted({
      inputValue: 'France',
      buttonText: 'France',
      query: 'France',
      clickedText: 'France',
    }),
    'France',
  );
  assert.equal(
    selectionLooksCommitted({
      inputValue: 'Immediate availability',
      buttonText: 'Immediate availability',
      query: 'Immediate availability',
      clickedText: 'Immediate availability',
    }),
    'Immediate availability',
  );
});

test('month aliases: February ↔ Feb ↔ 2 ↔ 02', () => {
  assert.equal(pickMatchingOption(['January', 'February', 'March'], '2')?.text, 'February');
  assert.equal(pickMatchingOption(['January', 'February', 'March'], 'February')?.text, 'February');
  assert.equal(pickMatchingOption(['01', '02', '03'], 'February')?.text, '02');
  assert.equal(pickMatchingOption(['1', '2', '3'], 'February')?.text, '2');
  assert.equal(pickMatchingOption(['2024', '2025', '2026'], '2026')?.text, '2026');
  assert.equal(pickMatchingOption(['2024', '2025', '2026'], '2025')?.text, '2025');
});
