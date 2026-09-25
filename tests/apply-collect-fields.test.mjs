import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { COLLECT_FIELDS } from '../lib/apply-collect-fields.mjs';
import { fieldCompletionIssue, fieldMatchesAnswer } from '../lib/apply-completion.mjs';

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true, channel: 'chrome' });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

const browser = await launchBrowser();
const page = await browser.newPage();

async function collect(html) {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  return page.evaluate(COLLECT_FIELDS);
}

test('identity fields: one entry each, no duplicate textbox wrapper', async () => {
  const fields = await collect(`
    <form>
      <label for="fn">First name</label><input id="fn" name="first_name">
      <label for="em">Email</label><input id="em" type="email" name="email">
      <div role="textbox"><input name="nested" placeholder="should not duplicate"></div>
    </form>
  `);
  assert.equal(fields.filter(f => f.type === 'text' || f.type === 'email').length, 3);
  assert.ok(!fields.some(f => f.role === 'textbox' && f.tag === 'div'), JSON.stringify(fields.map(f => f.tag + ':' + f.role)));
});

test('Ashby-style opacity-0 radios: group becomes ONE field with Yes/No options', async () => {
  const fields = await collect(`
    <div>
      <div class="question _required_">Are you authorized to work without sponsorship?</div>
      <div>
        <input type="radio" name="auth" id="y" value="yes" style="opacity:0;width:1px;height:1px">
        <label for="y">Yes</label>
        <input type="radio" name="auth" id="n" value="no" style="opacity:0;width:1px;height:1px">
        <label for="n">No</label>
      </div>
    </div>
  `);
  const radios = fields.filter(f => f.type === 'radio');
  assert.equal(radios.length, 1, JSON.stringify(radios.map(r => r.label)));
  assert.match(radios[0].label, /authorized to work/i);
  assert.equal(radios[0].options?.length, 2);
  assert.deepEqual(radios[0].options.map(o => o.text), ['Yes', 'No']);
  assert.equal(radios[0].required, true);
  assert.equal(radios[0].groupChecked, false);
});

test('nameless radios in a fieldset do not collapse to one empty group', async () => {
  const fields = await collect(`
    <fieldset>
      <legend>Do you require a visa?</legend>
      <label><input type="radio" value="yes"> Yes</label>
      <label><input type="radio" value="no"> No</label>
    </fieldset>
  `);
  const radios = fields.filter(f => f.type === 'radio');
  assert.equal(radios.length, 1, JSON.stringify(fields));
  assert.equal(radios[0].options?.length, 2);
  assert.ok(radios[0].options.every(o => o.text), JSON.stringify(radios[0].options));
  assert.match(radios[0].label, /visa/i);
});

test('two separate nameless radio groups stay distinct', async () => {
  const fields = await collect(`
    <fieldset><legend>Relocate?</legend>
      <label><input type="radio" value="yes"> Yes</label>
      <label><input type="radio" value="no"> No</label>
    </fieldset>
    <fieldset><legend>Remote?</legend>
      <label><input type="radio" value="yes"> Yes</label>
      <label><input type="radio" value="no"> No</label>
    </fieldset>
  `);
  const radios = fields.filter(f => f.type === 'radio');
  assert.equal(radios.length, 2, JSON.stringify(radios.map(r => r.label)));
  assert.match(radios[0].label, /Relocate/i);
  assert.match(radios[1].label, /Remote/i);
});

test('select-all-that-apply checkboxes stay independent with shared question', async () => {
  const fields = await collect(`
    <div>
      <div class="question">Which languages? Select all that apply</div>
      <label><input type="checkbox" name="lang" value="py"> Python</label>
      <label><input type="checkbox" name="lang" value="js"> JavaScript</label>
      <label><input type="checkbox" name="lang" value="go"> Go</label>
    </div>
  `);
  const boxes = fields.filter(f => f.type === 'checkbox');
  assert.equal(boxes.length, 3, JSON.stringify(boxes.map(b => b.label)));
  assert.ok(boxes.every(b => /languages/i.test(b.label)), boxes.map(b => b.label).join(' | '));
  assert.equal(boxes.filter(b => /Python/i.test(b.label)).length, 1);
  assert.equal(boxes.every(b => b.groupChecked === false), true);
});

test('ticking one mate of a checkbox group clears required-empty for the others', async () => {
  const fields = await collect(`
    <div>
      <div class="question">Location *</div>
      <label><input type="checkbox" name="loc" value="eu" checked> EU</label>
      <label><input type="checkbox" name="loc" value="us"> US</label>
    </div>
  `);
  const boxes = fields.filter(f => f.type === 'checkbox');
  assert.equal(boxes.length, 2);
  assert.ok(boxes.every(b => b.groupChecked === true), JSON.stringify(boxes));
});

test('lone consent checkbox does not swallow the rest of the form as its label', async () => {
  const fields = await collect(`
    <form>
      <label>First name <input name="first_name"></label>
      <label>Email <input type="email" name="email"></label>
      <div>
        <p class="question">I agree to the privacy policy</p>
        <label><input type="checkbox" name="consent"> I agree</label>
      </div>
    </form>
  `);
  const boxes = fields.filter(f => f.type === 'checkbox');
  assert.equal(boxes.length, 1, JSON.stringify(fields.map(f => f.label)));
  assert.ok(!/First name/i.test(boxes[0].label), boxes[0].label);
  assert.match(boxes[0].label, /privacy|agree/i);
});

test('hidden checkbox without a visible proxy is not collected', async () => {
  const fields = await collect(`
    <input type="checkbox" name="honeypot" style="display:none">
    <label><input type="checkbox" name="real"> Keep me posted</label>
  `);
  const boxes = fields.filter(f => f.type === 'checkbox');
  assert.equal(boxes.length, 1, JSON.stringify(boxes.map(b => b.label)));
  assert.match(boxes[0].label, /Keep me posted/i);
});

test('custom role=checkbox and role=switch are collected', async () => {
  const fields = await collect(`
    <div role="checkbox" aria-checked="false" tabindex="0">I agree to the terms</div>
    <div role="switch" aria-checked="true" tabindex="0">Email updates</div>
  `);
  const boxes = fields.filter(f => f.type === 'checkbox');
  assert.equal(boxes.length, 2, JSON.stringify(fields));
  assert.equal(boxes[0].checked, false);
  assert.equal(boxes[1].checked, true);
  assert.equal(boxes[1].groupChecked, true);
});

test('role=radio group under radiogroup is one field', async () => {
  const fields = await collect(`
    <div role="radiogroup" aria-label="Work authorization">
      <div role="radio" aria-checked="false">Yes</div>
      <div role="radio" aria-checked="false">No</div>
    </div>
  `);
  const radios = fields.filter(f => f.type === 'radio');
  assert.equal(radios.length, 1, JSON.stringify(fields));
  assert.equal(radios[0].options?.length, 2);
});

test('captcha token fields are skipped', async () => {
  const fields = await collect(`
    <textarea id="g-recaptcha-response" name="g-recaptcha-response" style="width:10px;height:10px">token</textarea>
    <label>First name <input name="first_name"></label>
  `);
  assert.ok(!fields.some(f => /recaptcha/i.test(f.name + f.idAttr)), JSON.stringify(fields));
});

test.after(async () => {
  await browser.close();
});

test('hidden file in a display:none panel is not collected', async () => {
  const fields = await collect(`
    <h1>Job</h1>
    <button>Apply for this job</button>
    <div style="display:none">
      <p>Click or drag file to upload</p>
      <input type="file" name="resume">
    </div>
    <label>Email <input type="email" name="email"></label>
  `);
  assert.equal(fields.filter(f => f.type === 'file').length, 0, JSON.stringify(fields.map(f => f.type + ':' + f.label)));
});

test('visible dropzone with hidden file input is collected', async () => {
  const fields = await collect(`
    <div>
      <p>Click or drag file to upload</p>
      <input type="file" name="resume" style="display:none">
    </div>
  `);
  assert.equal(fields.filter(f => f.type === 'file').length, 1, JSON.stringify(fields));
});

test('SmartRecruiters-style shadow SPL-DROPZONE file input is collected', async () => {
  await page.setContent(`<!doctype html><html><body>
    <label>Resume *</label>
    <spl-dropzone id="cv-dz"></spl-dropzone>
  </body></html>`);
  await page.evaluate(() => {
    const host = document.getElementById('cv-dz');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <div style="width:280px;height:96px;border:1px dashed #888;padding:12px">
        <p>Choose a file or drop it here</p>
        <input type="file" name="resume" accept=".pdf,.doc,.docx"
          style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden">
      </div>`;
  });
  const fields = await page.evaluate(COLLECT_FIELDS);
  const files = fields.filter(f => f.type === 'file');
  assert.equal(files.length, 1, JSON.stringify(fields));
  assert.match(files[0].label || '', /resume|choose a file|drop it here/i);
  assert.equal(String(files[0].i), '0');
  assert.equal(files[0].fileChip || '', '');
});

test('a filename chip counts as attached; a format hint in the empty dropzone does not', async () => {
  const empty = await collect(`
    <div style="width:280px;height:80px">
      <p>Choose a file or drop it here. Example: resume.pdf</p>
      <input type="file" name="resume">
    </div>
  `);
  assert.equal(empty.find(f => f.type === 'file')?.fileChip || '', '');

  const attached = await collect(`
    <div>
      <p>Click or drag file to upload</p>
      <span>Hugo-Vermot.pdf</span>
      <button type="button">Remove</button>
      <input type="file" name="resume" style="display:none">
    </div>
  `);
  assert.equal(attached.find(f => f.type === 'file')?.fileChip, 'Hugo-Vermot.pdf');
});

test('file in an aria-hidden Application tabpanel is not collected', async () => {
  const fields = await collect(`
    <button role="tab" aria-selected="true">Overview</button>
    <button role="tab" id="app-tab" aria-selected="false">Application</button>
    <p>Company overview copy.</p>
    <div role="tabpanel" aria-labelledby="app-tab" aria-hidden="true">
      <p>Click or drag file to upload</p>
      <input type="file" name="resume">
      <input name="first_name">
    </div>
  `);
  assert.equal(fields.filter(f => f.type === 'file').length, 0, JSON.stringify(fields));
  assert.ok(!fields.some(f => f.name === 'first_name'));
});

test('button aria-haspopup=listbox is collected even without role=combobox', async () => {
  const fields = await collect(`
    <label>Country *</label>
    <button type="button" aria-haspopup="listbox">Select...</button>
    <button type="button" aria-haspopup="menu">Apply</button>
  `);
  const lists = fields.filter(f => f.ariaHaspopup === 'listbox' || f.ariaHaspopup === 'menu');
  assert.equal(lists.length, 1, JSON.stringify(fields.map(f => `${f.tag}:${f.ariaHaspopup}:${f.label}`)));
  assert.equal(lists[0].ariaHaspopup, 'listbox');
  assert.match(lists[0].label, /country/i);
});

test('button role=combobox is collected (custom ATS select)', async () => {
  const fields = await collect(`
    <label>Years of experience *</label>
    <button type="button" role="combobox" aria-haspopup="listbox">Select...</button>
  `);
  const combo = fields.find(f => f.role === 'combobox');
  assert.ok(combo, JSON.stringify(fields));
  assert.match(combo.label, /experience/i);
});

test('Your answer textarea keeps the question as its label', async () => {
  const fields = await collect(`
    <div>
      <div>Why are you interested in this role?</div>
      <textarea placeholder="Your answer"></textarea>
    </div>
  `);
  const area = fields.find(f => f.tag === 'textarea');
  assert.ok(area, JSON.stringify(fields));
  assert.match(area.label, /interested/i);
});

test('combobox wrapper is not duplicated when the inner input is visible', async () => {
  const fields = await collect(`
    <div role="combobox">
      <input name="country" aria-label="Country">
    </div>
  `);
  assert.equal(fields.length, 1, JSON.stringify(fields));
  assert.equal(fields[0].tag, 'input');
});

test('required is detected from asterisk, aria, data-required and wrapper class', async () => {
  const fields = await collect(`
    <label>LinkedIn Profile <input name="linkedin"></label>
    <label>First Name * <input name="first_name"></label>
    <label>Email <input type="email" name="email" aria-required="true"></label>
    <div class="field required"><label>City</label><input name="city"></div>
    <div class="question _required_"><label>Arabic</label><input name="arabic"></div>
    <label>Portfolio <input name="portfolio" data-required="true"></label>
  `);
  const byName = Object.fromEntries(fields.map(f => [f.name, f]));
  assert.equal(byName.linkedin.required, false, JSON.stringify(byName.linkedin));
  assert.equal(byName.first_name.required, true);
  assert.equal(byName.email.required, true);
  assert.equal(byName.city.required, true);
  assert.equal(byName.arabic.required, true);
  assert.equal(byName.portfolio.required, true);
});

test('disabled, readonly and inert controls are not fill targets', async () => {
  const fields = await collect(`<fieldset disabled><input name="disabled"></fieldset>
    <input name="locked" readonly value="Account name">
    <div inert><input name="inactive"></div>
    <div aria-disabled="true"><input name="blocked"></div>
    <label>Email <input type="email" name="email"></label>`);
  assert.deepEqual(fields.map(f => f.name), ['email']);
});

test('placeholder examples do not pollute an explicit field label', async () => {
  const fields = await collect('<label for="email">Email</label><input id="email" name="email" aria-label="Email" placeholder="hello@example.com">');
  assert.equal(fields[0].label, 'Email');
});

test('field descriptions, constraints and browser validation survive collection', async () => {
  const fields = await collect(`<label>Email<input type="email" name="email" value="invalid" aria-describedby="hint error" maxlength="100"></label>
    <p id="hint">Use your contact email.</p><p id="error">Check the address.</p>`);
  assert.equal(fields[0].maxLength, 100);
  assert.equal(fields[0].description, 'Use your contact email. Check the address.');
  assert.equal(fields[0].invalid, true);
  assert.ok(fieldCompletionIssue(fields[0]));
});

test('required attachment is pending until a real file is selected', async () => {
  let fields = await collect('<label>Resume<input type="file" name="resume" required></label>');
  assert.equal(fieldCompletionIssue(fields[0]), 'fichier requis manquant');
  await page.locator('input').setInputFiles({name:'fixture.txt', mimeType:'text/plain', buffer:Buffer.from('Local test only')});
  fields = await page.evaluate(COLLECT_FIELDS);
  assert.equal(fields[0].fileCount, 1);
  assert.equal(fieldCompletionIssue(fields[0]), null);
});

test('a value rejected by the ATS remains pending after typing', async () => {
  const fields = await collect('<label>Portfolio<input name="portfolio" value="https://example.test" aria-invalid="true"></label>');
  assert.ok(fieldCompletionIssue(fields[0]));
});

test('completion rejects truncated, duplicated and unreadable answers', async () => {
  await collect('<input name="answer" maxlength="4"><div contenteditable="true">A complete answer</div>');
  const input = page.locator('input');
  await input.pressSequentially('abcdef');
  assert.equal(await fieldMatchesAnswer(input, 'abcdef'), false);
  assert.equal(await fieldMatchesAnswer(input, 'abcd'), true);
  assert.equal(await fieldMatchesAnswer(page.locator('[contenteditable]'), 'A complete answer'), true);
  await page.locator('[contenteditable]').fill('A complete answerA complete answer');
  assert.equal(await fieldMatchesAnswer(page.locator('[contenteditable]'), 'A complete answer'), false);
  assert.equal(await fieldMatchesAnswer({inputValue:async()=>{throw Error();},evaluate:async()=>{throw Error();}}, 'answer'), false);
});

test('tel fields compare digits only — a masked phone widget reformatting spacing is not a mismatch (#3510-phone)', async () => {
  await collect('<input type="tel" name="phone" value="+1 ">');
  const input = page.locator('input[type="tel"]');
  // react-international-phone and similar widgets keep every digit but drop
  // the spacing a fill() typed in — byte-exact comparison would report this
  // as a failed fill and send the caller into a retry loop that clears the
  // field without ever landing a value.
  await input.fill('+66 627842137');
  assert.equal(await fieldMatchesAnswer(input, '+66 62 784 2137', 'tel'), true);
  assert.equal(await fieldMatchesAnswer(input, '+66 62 784 2137'), false); // untyped: exact match still applies elsewhere
  assert.equal(await fieldMatchesAnswer(input, '+33 6 12 34 56 78', 'tel'), false); // genuinely wrong number
  await input.fill('');
  assert.equal(await fieldMatchesAnswer(input, '', 'tel'), false); // empty actual never "matches" — even an empty expectation
});

test('Ashby Yes/No exposes two options and No counts as answered', async () => {
  let fields = await collect(`<div><label>Do you need sponsorship? *</label>
    <div class="ashby-application-form-input-yesno">
    <button data-option="yes" aria-pressed="false">Yes</button>
    <button data-option="no" aria-pressed="false" onclick="this.setAttribute('aria-pressed','true')">No</button>
    <input type="checkbox" name="sponsorship" style="opacity:0"></div></div>`);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].type, 'radio');
  assert.deepEqual(fields[0].options.map(o => o.text), ['Yes','No']);
  assert.ok(fieldCompletionIssue(fields[0]));
  await page.locator(`[data-co-opt="${fields[0].options[1].key}"]`).click();
  fields = await page.evaluate(COLLECT_FIELDS);
  assert.equal(fields[0].groupChecked, true);
  assert.equal(fieldCompletionIssue(fields[0]), null);
});
