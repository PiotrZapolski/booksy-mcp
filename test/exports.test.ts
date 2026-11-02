import { strToU8, zipSync } from 'fflate';
import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extensionFor, saveFile } from '../src/exports/files.js';
import { readWorkbook, toCsv, toRecords, toTable } from '../src/exports/sheet.js';
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

/** Layout of a Booksy report: title lines, period, labels from column C, row numbers in column B. */
export function reportWorkbook(): Uint8Array {
  const text = (ref: string, value: string): string =>
    `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const number = (ref: string, value: string): string => `<c r="${ref}"><v>${value}</v></c>`;
  return zipSync({
    'xl/workbook.xml': strToU8(
      '<workbook xmlns:r="x"><sheets><sheet name="Lista wizyt" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      '<worksheet><sheetData>' +
        `<row r="1">${text('B1', 'Booksy')}</row>` +
        `<row r="2">${text('B2', 'Lista wizyt')}</row>` +
        `<row r="3">${text('B3', 'Okres od 01.10.2026 do 31.10.2026')}</row>` +
        '<row r="4"/>' +
        `<row r="5">${text('C5', 'Klient')}${text('D5', 'Data')}${text('E5', 'Kwota')}${text('F5', 'Telefon')}${text('G5', 'E-mail')}</row>` +
        `<row r="6">${number('B6', '1')}${text('C6', 'Sample Client')}${text('D6', '31.10.2026 19:00')}${number('E6', '130')}${text('F6', '500600700')}${text('G6', 'client@example.com')}</row>` +
        `<row r="7">${number('B7', '2')}${text('C7', 'Other Client')}${text('D7', '30.10.2026 10:00')}${number('E7', '9.630000000000001')}${text('F7', '')}${text('G7', '')}</row>` +
        `<row r="8">${text('C8', 'Razem')}${number('E8', '139.63000000000002')}</row>` +
        '<row r="9"/>' +
        `<row r="10">${text('C10', 'Metoda')}${text('D10', 'Kwota')}</row>` +
        `<row r="11">${text('C11', 'Karta')}${number('D11', '130')}</row>` +
        '</sheetData></worksheet>',
    ),
  });
}

describe('report layout', () => {
  const [sheet] = readWorkbook(reportWorkbook());
  const table = toTable(sheet?.rows ?? []);

  it('finds the labels under the title lines, not the wider first data row', () => {
    expect(table.records[0]).toEqual({
      Klient: 'Sample Client',
      Data: '31.10.2026 19:00',
      Kwota: '130',
      Telefon: '500600700',
      'E-mail': 'client@example.com',
    });
  });

  it('stops at the summary and keeps what lies below it apart', () => {
    expect(table.records).toHaveLength(2);
    expect(table.totals).toMatchObject({ Klient: 'Razem', Kwota: '139.63' });
    expect(table.extraRows).toEqual([
      ['', '', 'Metoda', 'Kwota'],
      ['', '', 'Karta', '130'],
    ]);
  });

  it('removes float noise from numbers and nothing else', () => {
    expect(table.records[1]?.Kwota).toBe('9.63');
    expect(sheet?.rows.flat()).toContain('500600700');
  });

  it('keeps an unlabelled column that is not a row counter', () => {
    const records = toRecords([
      ['Nazwa', 'Kwota', ''],
      ['A', '10', 'x'],
      ['B', '20', 'y'],
    ]);
    expect(records[1]).toEqual({ Nazwa: 'B', Kwota: '20', column_3: 'y' });
  });

  it('handles a table labelled with values, such as one column per month', () => {
    const records = toRecords([
      ['Tytuł'],
      ['Pracownik', '10.2026', '11.2026'],
      ['A', '1', '2'],
    ]);
    expect(records).toEqual([{ Pracownik: 'A', '10.2026': '1', '11.2026': '2' }]);
  });
});

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
