// tests/providers/taiwanjobs.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — taiwanjobs');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/taiwanjobs.mjs')).href);
  const taiwanjobs = mod.default;
  const { parseTaiwanJobsConfig, taiwanField, taiwanJobsText, normalizeTaiwanJobsRecord } = mod;

  if (taiwanjobs.id === 'taiwanjobs') pass('taiwanjobs.id is "taiwanjobs"');
  else fail(`taiwanjobs.id is ${JSON.stringify(taiwanjobs.id)}`);

  const hit = taiwanjobs.detect({ provider: 'taiwanjobs' });
  if (hit?.url === 'https://apiservice.mol.gov.tw/OdService/rest/datastore/A17000000J-030144-VAL') {
    pass('taiwanjobs.detect() claims explicit provider entries');
  } else {
    fail(`taiwanjobs.detect() = ${JSON.stringify(hit)}`);
  }

  const cfg = parseTaiwanJobsConfig({
    taiwanjobs: { keywords: [' AI ', '', 7, '產品經理'], max_records: 999999, remote_only: true },
  });
  if (JSON.stringify(cfg.keywords) === JSON.stringify(['AI', '產品經理']) && cfg.maxRecords === 5000 && cfg.remoteOnly === true) {
    pass('parseTaiwanJobsConfig trims keywords and clamps max_records');
  } else {
    fail(`parseTaiwanJobsConfig = ${JSON.stringify(cfg)}`);
  }

  const row = {
    'OCCU_DESC（職務名稱）': '  AI 產品經理 ',
    'JOB_DETAIL（工作內容）': '負責遠端 AI product planning',
    'CITYNAME（工作地點）': '台北市信義區',
    'URL_QUERY（職缺資料URL）': 'https://job.taiwanjobs.gov.tw/Internet/jobwanted/JobDetail.aspx?HIRE_ID=1',
    'COMPNAME（公司名稱）': '台灣科技公司',
    'TRANDATE（職缺更新日期）': '20260901',
    'NT_L（薪資範圍下限）': '60000',
    'NT_U（薪資範圍上限）': '90000',
  };

  if (taiwanField(row, 'OCCU_DESC') === 'AI 產品經理' && taiwanField(row, 'MISSING') === '') {
    pass('taiwanField() reads labelled prefix keys and returns "" for missing fields');
  } else {
    fail(`taiwanField() = ${JSON.stringify(taiwanField(row, 'OCCU_DESC'))}`);
  }
  if (/AI 產品經理/.test(taiwanJobsText(row)) && /台灣科技公司/.test(taiwanJobsText(row))) {
    pass('taiwanJobsText() builds searchable text from title/company/location/description');
  } else {
    fail(`taiwanJobsText() = ${JSON.stringify(taiwanJobsText(row))}`);
  }

  const norm = normalizeTaiwanJobsRecord(row);
  if (
    norm?.title === 'AI 產品經理'
    && norm.url.includes('job.taiwanjobs.gov.tw')
    && norm.company === '台灣科技公司'
    && norm.location === '台北市信義區, Taiwan'
    && norm.description === '負責遠端 AI product planning'
    && norm.postedAt === Date.parse('2026-09-01T00:00:00+08:00')
    && norm.salary?.min === 60000
    && norm.salary?.max === 90000
    && norm.salary?.currency === 'TWD'
  ) {
    pass('normalizeTaiwanJobsRecord() maps fields, date, and TWD salary');
  } else {
    fail(`normalizeTaiwanJobsRecord() = ${JSON.stringify(norm)}`);
  }
  if (normalizeTaiwanJobsRecord({ ...row, 'URL_QUERY（職缺資料URL）': 'http://job.taiwanjobs.gov.tw/x' }) === null) {
    pass('normalizeTaiwanJobsRecord() rejects non-https posting URLs');
  } else {
    fail('normalizeTaiwanJobsRecord() should reject non-https URLs');
  }

  const fetched = await taiwanjobs.fetch(
    { name: 'Taiwan', taiwanjobs: { keywords: ['AI'], remote_only: true, max_records: 2 } },
    {
      fetchJson: async (url, opts) => ({
        seenUrl: url,
        seenOpts: opts,
        result: {
          records: [
            row,
            { ...row, 'URL_QUERY（職缺資料URL）': 'https://job.taiwanjobs.gov.tw/Internet/jobwanted/JobDetail.aspx?HIRE_ID=1' },
            { ...row, 'OCCU_DESC（職務名稱）': 'Maintenance Engineer', 'JOB_DETAIL（工作內容）': 'remote systems work', 'URL_QUERY（職缺資料URL）': 'https://job.taiwanjobs.gov.tw/Internet/jobwanted/JobDetail.aspx?HIRE_ID=2' },
            { ...row, 'OCCU_DESC（職務名稱）': 'Chef', 'JOB_DETAIL（工作內容）': 'kitchen' },
          ],
        },
      }),
    },
  );
  if (fetched.length === 1 && fetched[0].title === 'AI 產品經理') {
    pass('taiwanjobs.fetch() filters keywords/remote markers, acronym substrings, and dedups URLs');
  } else {
    fail(`taiwanjobs.fetch() = ${JSON.stringify(fetched)}`);
  }
} catch (e) {
  fail(`taiwanjobs provider tests crashed: ${e.message}`);
}
