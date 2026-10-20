import test from 'node:test';
import assert from 'node:assert/strict';
import { customChoiceFor, customAnswerFor } from '../lib/apply-custom-choice.mjs';

// The shape lib/apply-spec.mjs builds from screening.custom_answers (Hugo, 2026-10-20).
const ANSWERS = [
  { question: 'AI tools', answer: 'Daily…', match: 'ai (coding|code|assisted|tools?)|cursor|claude code|copilot|how often .{0,40}\\bai\\b|ai-assisted', preferOptions: ['Daily', 'Every day', 'Several times a day'] },
  { question: 'React/TS', answer: 'vibe coding…', match: 'react|typescript|front-?end (skills|code|coding)|javascript', preferOptions: ['vibe', 'AI-assisted', 'with AI', 'I can build individual components with some help', 'individual components'] },
  { question: 'e-commerce', answer: 'Shiseido…', match: 'e-?commerce|marketing|paid ads|growth products?|retail|online store', preferOptions: ['Yes, it was the main focus of a past role', 'main focus', 'Yes'] },
  { question: 'AI interfaces', answer: 'Creads…', match: '\\b(ai|agent|agentic|llm|genai|generative)\\b.{0,80}(interface|product|feature|ux|design|ship|production)|(interface|product|feature|ux|design|ship|production).{0,80}\\b(ai|agent|agentic|llm|genai)\\b', preferOptions: ['Yes, I led the design and build of AI features in production', 'led the design and build', 'Yes'] },
];

test('Darkroom pick lists take the candidate\'s own choices', () => {
  assert.equal(customChoiceFor('How would you rate your React and TypeScript skills?', [
    'I can own a production frontend codebase (architecture, state, performance)', 'I can build complete features in an existing codebase',
    'I can build individual components with some help', 'Little or no hands-on experience'], ANSWERS), 'I can build individual components with some help');
  assert.equal(customChoiceFor('Have you designed and shipped interfaces for AI or agent products (e.g., streaming responses, showing agent reasoning, approval flows, LLM-powered features)?', [
    'Yes, I led the design and build of AI features in production', 'Yes, I contributed to AI features in production', 'Only in side projects or prototypes', 'No, not yet'], ANSWERS), 'Yes, I led the design and build of AI features in production');
  assert.equal(customChoiceFor('How often do you use AI coding tools like Cursor or Claude Code in your work?', ['Daily', 'A few times a week', 'Occasionally', 'Never'], ANSWERS), 'Daily');
  assert.equal(customChoiceFor('Have you worked on marketing, ecommerce or analytics products, or run paid ads yourself?', [
    'Yes, it was the main focus of a past role', 'Yes, as part of a broader product or on the side', 'No'], ANSWERS), 'Yes, it was the main focus of a past role');
});

test('an AI-assisted React row wins over the generic one when a form offers it', () => {
  assert.equal(customChoiceFor('React / TypeScript level', ['Expert', 'I build with AI-assisted coding (vibe coding)', 'I can build individual components with some help'], ANSWERS),
    'I build with AI-assisted coding (vibe coding)');
});

test('no preferred row on the list → null (resolver / human), never a guess', () => {
  assert.equal(customChoiceFor('How many years of React experience?', ['0-1', '2-3', '4-5', '6+'], ANSWERS), null);
  assert.equal(customChoiceFor('What is your favourite colour?', ['Red', 'Blue'], ANSWERS), null);
  assert.equal(customAnswerFor('What is your favourite colour?', ANSWERS), null);
});