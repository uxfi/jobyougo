import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isHimalayasHost,
  isHimalayasLoginPath,
  shouldEnsureHimalayasSession,
  samePageUrl,
  inferHimalayasLoggedIn,
  canAttemptHimalayasLogin,
  looksLikeHimalayasLoginError,
} from '../lib/himalayas-apply.mjs';

test('isHimalayasHost accepts apex and www, rejects lookalikes', () => {
  assert.equal(isHimalayasHost('https://himalayas.app/companies/x/jobs/y'), true);
  assert.equal(isHimalayasHost('https://www.himalayas.app/login'), true);
  assert.equal(isHimalayasHost('https://jobs.ashbyhq.com/acme'), false);
  assert.equal(isHimalayasHost('https://evil-himalayas.app/login'), false);
  assert.equal(isHimalayasHost('not-a-url'), false);
});

test('isHimalayasLoginPath ignores query/hash', () => {
  assert.equal(isHimalayasLoginPath('https://himalayas.app/login'), true);
  assert.equal(isHimalayasLoginPath('https://himalayas.app/login/'), true);
  assert.equal(isHimalayasLoginPath('https://himalayas.app/login?next=/jobs'), true);
  assert.equal(isHimalayasLoginPath('https://himalayas.app/companies/x/jobs/y'), false);
});

test('shouldEnsureHimalayasSession skips employer ATS after Apply redirect', () => {
  const job = 'https://himalayas.app/companies/acme/jobs/designer';
  assert.equal(shouldEnsureHimalayasSession({
    jobUrl: job,
    currentUrl: 'https://job-boards.greenhouse.io/acme/jobs/1',
  }), false);
  assert.equal(shouldEnsureHimalayasSession({
    jobUrl: job,
    currentUrl: job,
  }), true);
  assert.equal(shouldEnsureHimalayasSession({
    jobUrl: job,
    currentUrl: 'https://himalayas.app/login',
  }), true);
  // Non-Himalayas offer that somehow lands on Himalayas login — still ensure
  assert.equal(shouldEnsureHimalayasSession({
    jobUrl: 'https://jobs.ashbyhq.com/x',
    currentUrl: 'https://himalayas.app/login',
  }), true);
});

test('samePageUrl tolerates trailing slash and hash', () => {
  const a = 'https://himalayas.app/companies/x/jobs/y';
  assert.equal(samePageUrl(a, a + '/'), true);
  assert.equal(samePageUrl(a, a + '#section'), true);
  assert.equal(samePageUrl(a, a + '?ref=1'), false);
});

test('inferHimalayasLoggedIn: no Log in CTA ⇒ logged in; CTA ⇒ logged out', () => {
  assert.equal(inferHimalayasLoggedIn({
    currentUrl: 'https://himalayas.app/companies/x/jobs/y',
    hasNavLoginCta: false,
  }), true);
  assert.equal(inferHimalayasLoggedIn({
    currentUrl: 'https://himalayas.app/companies/x/jobs/y',
    hasNavLoginCta: true,
  }), false);
  assert.equal(inferHimalayasLoggedIn({
    currentUrl: 'https://himalayas.app/login',
    hasNavLoginCta: false,
  }), false);
  assert.equal(inferHimalayasLoggedIn({
    currentUrl: 'https://boards.greenhouse.io/x',
    hasNavLoginCta: false,
  }), false);
});

test('canAttemptHimalayasLogin caps retries', () => {
  assert.equal(canAttemptHimalayasLogin(0), true);
  assert.equal(canAttemptHimalayasLogin(1), true);
  assert.equal(canAttemptHimalayasLogin(2), false);
  assert.equal(canAttemptHimalayasLogin(0, 1), true);
  assert.equal(canAttemptHimalayasLogin(1, 1), false);
});

test('looksLikeHimalayasLoginError matches common copy', () => {
  assert.equal(looksLikeHimalayasLoginError('Invalid email or password'), true);
  assert.equal(looksLikeHimalayasLoginError('Mot de passe incorrect'), true);
  assert.equal(looksLikeHimalayasLoginError('Welcome back. Please enter your details.'), false);
});
