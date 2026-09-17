import test from 'node:test';
import assert from 'node:assert/strict';
import {
  basenamePath,
  chromeClosedMessage,
  isTargetClosedError,
  looksLikePostApplyPath,
  postApplyMessage,
} from '../lib/apply-runtime.mjs';

test('looksLikePostApplyPath recognizes Recruitee email verification after apply', () => {
  assert.equal(
    looksLikePostApplyPath('https://jobs.simple.life/jobs/8285191-senior-product-designer/applications/email_verification_needed'),
    true,
  );
});

test('looksLikePostApplyPath recognizes thank-you and application-submitted paths', () => {
  assert.equal(looksLikePostApplyPath('https://boards.example.com/jobs/1/thank-you'), true);
  assert.equal(looksLikePostApplyPath('/apply/success'), true);
  assert.equal(looksLikePostApplyPath('/apply-success'), true);
  assert.equal(looksLikePostApplyPath('/application-submitted'), true);
});

test('looksLikePostApplyPath ignores review, login and generic confirm pages', () => {
  assert.equal(looksLikePostApplyPath('https://jobs.example.com/jobs/1/apply'), false);
  assert.equal(looksLikePostApplyPath('/review-and-confirm'), false);
  assert.equal(looksLikePostApplyPath('/login/verify'), false);
  assert.equal(looksLikePostApplyPath('/users/email-confirmation'), false);
  assert.equal(looksLikePostApplyPath(''), false);
});

test('isTargetClosedError matches Playwright closed-target messages', () => {
  assert.equal(isTargetClosedError(new Error('page.evaluate: Target page, context or browser has been closed')), true);
  assert.equal(isTargetClosedError(new Error('frame.evaluate: Target page, context or browser has been closed')), true);
  assert.equal(isTargetClosedError('locator.click: Target page, context or browser has been closed'), true);
  assert.equal(isTargetClosedError(new Error('Protocol error (Runtime.callFunctionOn): Session closed.')), true);
  assert.equal(isTargetClosedError(new Error('Please correct the required fields')), false);
  assert.equal(isTargetClosedError(null), false);
});

test('basenamePath handles Windows and POSIX CV paths', () => {
  assert.equal(basenamePath('C:\\Users\\PC\\Desktop\\jobyougo-main\\career-ops\\output\\Hugo_Vermot_CV_Complete_Paris.pdf'), 'Hugo_Vermot_CV_Complete_Paris.pdf');
  assert.equal(basenamePath('/tmp/career-ops/output/cv.pdf'), 'cv.pdf');
});

test('postApplyMessage mentions email when the ATS asks to verify it', () => {
  assert.match(postApplyMessage('https://jobs.simple.life/x/applications/email_verification_needed'), /boîte mail/i);
  assert.match(postApplyMessage('https://example.com/thank-you'), /confirmation/i);
  assert.match(chromeClosedMessage(), /Chrome/);
});
