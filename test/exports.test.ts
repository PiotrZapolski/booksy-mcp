import { strToU8, zipSync } from 'fflate';
import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extensionFor, saveFile } from '../src/exports/files.js';
import { readWorkbook, toCsv, toRecords } from '../src/exports/sheet.js';
import { tempDir } from './helpers.js';

export function sampleWorkbook(): Uint8Array {
  return zipSync({
    'xl/workbook.xml': strToU8(
      '<workbook xmlns:r="x"><sheets><sheet name="Lista &amp; wizyt" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/sharedStrings.xml': strToU8(
      '<sst><si><t>Raport</t></si><si><t>Data</t></si><si><t>Klient</t></si><si><r><t>Kwo</t></r><r><t xml:space="preserve">ta</t></r></si><si><t>Sample &lt;Client&gt;</t></si></sst>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      '<worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c></row>' +
        '<row r="3"><c r="A3"><v>46000</v></c><c r="B3" t="s"><v>4</v></c><c r="D3" t="inlineStr"><is><t>extra</t></is></c></row>' +
        '<row r="4"/>' +
        '<row r="5"><c r="A5" s="2"/><c r="C5"><v>12.5</v></c></row>' +
        '</sheetData></worksheet>',
    ),
    'xl/styles.xml': strToU8('<ignored/>'),
  });
}

describe('readWorkbook', () => {
  it('reads shared strings, inline strings, gaps and rich text', () => {
    const [sheet] = readWorkbook(sampleWorkbook());
    expect(sheet?.name).toBe('Lista & wizyt');
    expect(sheet?.rows[1]).toEqual(['Data', 'Klient', 'Kwota']);
    expect(sheet?.rows[2]).toEqual(['46000', 'Sample <Client>', '', 'extra']);
    expect(sheet?.rows[4]).toEqual(['', '', '12.5']);
  });

  it('rejects something that is not a workbook', () => {
    expect(() => readWorkbook(new Uint8Array([1, 2, 3]))).toThrow();
  });
});

describe('toRecords', () => {
  it('skips title lines and uses the real header', () => {
    const records = toRecords([['Raport'], ['Data', 'Klient'], ['2026-01-01', 'A'], ['', '']]);
    expect(records).toEqual([{ Data: '2026-01-01', Klient: 'A' }]);
  });

  it('handles an empty sheet', () => {
    expect(toRecords([])).toEqual([]);
  });
});

describe('toCsv', () => {
  it('quotes and neutralises formulas, keeps numbers', () => {
    expect(toCsv([['a,b', 'say "hi"', '=HYPERLINK("x")', '-12.5', '+48123']])).toBe(
      '"a,b","say ""hi""","\'=HYPERLINK(""x"")",-12.5,+48123',
    );
  });
});

describe('saveFile', () => {
  it('writes a private file with a clean name', () => {
    const path = saveFile(
      tempDir(),
      { base: 'x', filename: '../../etc/pass wd.xlsx', extension: '.xlsx', bytes: new Uint8Array([1]) },
      new Date('2026-11-02T10:00:00Z'),
    );
    expect(path).toContain('2026-11-02T10-00-00-pass wd.xlsx');
    expect(path).not.toContain('..');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('picks the extension from the content type', () => {
    expect(extensionFor('application/pdf; charset=binary', '.bin')).toBe('.pdf');
    expect(extensionFor(null, '.bin')).toBe('.bin');
  });
});
