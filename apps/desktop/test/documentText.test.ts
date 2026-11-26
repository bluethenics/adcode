import { describe, expect, it } from "vitest";
import {
  documentFormat,
  DocumentError,
  excelDate,
  extractDocument,
  isDateFormat,
  openZip,
  type PdfLike,
} from "../src/renderer/ai/documentText.ts";
import { textPdf, zipArchive } from "./fixtures/zipFixture.ts";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const noPdf = async (): Promise<PdfLike> => { throw new Error("not a PDF"); };

/** PDF.js as it runs under Node: the same parser the window loads, without the worker file. */
async function nodePdf(bytes: Uint8Array): Promise<PdfLike> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  return pdfjs.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise as unknown as Promise<PdfLike>;
}

describe("which files are documents", () => {
  it("knows them by MIME type or by extension", () => {
    expect(documentFormat("report.pdf", "")).toBe("pdf");
    expect(documentFormat("x", "application/pdf")).toBe("pdf");
    expect(documentFormat("Budget.XLSX", "")).toBe("xlsx");
    expect(documentFormat("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("docx");
    expect(documentFormat("deck.pptx", "")).toBe("pptx");
    expect(documentFormat("sheet.ods", "")).toBe("ods");
    expect(documentFormat("notes.txt", "text/plain")).toBeNull();
  });
});

describe("Word", () => {
  it("reads paragraphs, tabs, breaks and tables, a text box once, and not deleted text", async () => {
    const body = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
  <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Quarterly plan</w:t></w:r></w:p>
  <w:p><w:r><w:t xml:space="preserve">Ship </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>faster</w:t></w:r><w:r><w:tab/><w:t>Q&amp;A</w:t></w:r><w:r><w:br/><w:t>next line</w:t></w:r><w:del><w:r><w:delText>removed words</w:delText></w:r></w:del></w:p>
  <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Due</w:t></w:r></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:r><w:t>Sam</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Friday</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  <w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><w:txbxContent><w:p><w:r><w:t>Boxed note</w:t></w:r></w:p></w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent><w:p><w:r><w:t>Boxed note</w:t></w:r></w:p></w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>
</w:body></w:document>`;
    const read = await extractDocument("docx", "plan.docx", zipArchive({ "[Content_Types].xml": "<Types/>", "word/document.xml": body }), 50_000, noPdf);
    expect(read.detail).toBe("Word");
    expect(read.text).toContain("[Text read from plan.docx (Word document). Pictures, charts and layout are not included.]");
    expect(read.text).toContain("Quarterly plan\nShip faster\tQ&A\nnext line");
    expect(read.text).toContain("Owner | Due\nSam | Friday");
    expect(read.text.match(/Boxed note/g)).toHaveLength(1);
    expect(read.text).not.toContain("removed words");
  });

  it("refuses a password-protected or damaged file with a sentence naming it", async () => {
    await expect(extractDocument("docx", "broken.docx", new TextEncoder().encode("not a zip"), 50_000, noPdf)).rejects.toThrow(/broken\.docx could not be opened/);
    const zip = zipArchive({ "word/document.xml": "<w:document/>" });
    // Set the "encrypted" flag in the central directory entry.
    const view = new DataView(zip.buffer);
    for (let at = zip.length - 22; at > 0; at -= 1) if (view.getUint32(at, true) === 0x02014b50) { view.setUint16(at + 8, 1, true); break; }
    await expect(extractDocument("docx", "locked.docx", zip, 50_000, noPdf)).rejects.toThrow(/locked\.docx is password-protected/);
  });
});

describe("Excel", () => {
  const workbook = zipArchive({
    "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/><sheet name="Notes &amp; ideas" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type=".../worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type=".../worksheet" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId3" Type=".../styles" Target="styles.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst count="3" uniqueCount="3"><si><t>Region</t></si><si><r><rPr><b/></rPr><t>Ho</t></r><r><t>tel, Inc</t></r><rPh><t>ホテル</t></rPh></si><si><t>Date</t></si></sst>`,
    "xl/styles.xml": `<styleSheet><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00"/></numFmts><cellStyleXfs count="1"><xf numFmtId="14"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c><c r="C1" t="inlineStr"><is><t>Total</t></is></c></row>
      <row r="2"/>
      <row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" s="1"><v>45000</v></c><c r="C3" s="2"><v>1234.5</v></c><c r="E3" t="b"><v>1</v></c><c r="F3" t="str"><f>A3&amp;"!"</f><v>says "hi"</v></c></row>
      <row r="4"><c r="B4" s="3"><v>45000.75</v></c></row>
    </sheetData></worksheet>`,
    "xl/worksheets/sheet2.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Second sheet</t></is></c></row></sheetData></worksheet>`,
  });

  it("reads every sheet as CSV: shared and inline strings, dates, booleans and formula results", async () => {
    const read = await extractDocument("xlsx", "sales.xlsx", workbook, 50_000, noPdf);
    expect(read.detail).toBe("Excel · 2 sheets");
    expect(read.text).toContain("## Sheet: Sales\nRegion,Date,Total\n\"Hotel, Inc\",2023-03-15,1234.5,,TRUE,\"says \"\"hi\"\"\"\n,2023-03-15 18:00");
    expect(read.text).toContain("## Sheet: Notes & ideas\nSecond sheet");
    expect(read.text).not.toContain("ホテル");
  });

  it("stops at the limit and says how many sheets it read", async () => {
    const read = await extractDocument("xlsx", "sales.xlsx", workbook, 10, noPdf);
    expect(read.detail).toBe("Excel · 1 of 2 sheets");
  });

  it("tells date formats from number formats", () => {
    expect(isDateFormat("yyyy\\-mm\\-dd")).toBe(true);
    expect(isDateFormat("[$-409]mmmm d, yyyy")).toBe(true);
    expect(isDateFormat("[h]:mm")).toBe(true);
    expect(isDateFormat("\"$\"#,##0.00")).toBe(false);
    expect(isDateFormat("[Red]0.00")).toBe(false);
    expect(isDateFormat("General")).toBe(false);
    expect(excelDate(45000, false)).toBe("2023-03-15");
    expect(excelDate(0.5, false)).toBe("12:00");
    expect(excelDate(0, true)).toBe("00:00");
  });

  it("refuses an archive that claims to unpack to more than it can hold", async () => {
    const zip = zipArchive({ "xl/workbook.xml": "<workbook/>" });
    const view = new DataView(zip.buffer);
    for (let at = zip.length - 22; at > 0; at -= 1) if (view.getUint32(at, true) === 0x02014b50) { view.setUint32(at + 24, 500_000_000, true); break; }
    await expect(openZip(zip, "huge.xlsx").text("xl/workbook.xml")).rejects.toThrow(DocumentError);
  });
});

describe("PowerPoint", () => {
  it("reads slides in the deck's order, not the files' numbers", async () => {
    const slide = (words: string): string => `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${words}</a:t></a:r><a:br/><a:r><a:t>more</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    const deck = zipArchive({
      "ppt/presentation.xml": `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
      "ppt/_rels/presentation.xml.rels": `<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>`,
      "ppt/slides/slide1.xml": slide("Moved to second"),
      "ppt/slides/slide2.xml": slide("Opening slide"),
    });
    const read = await extractDocument("pptx", "deck.pptx", deck, 50_000, noPdf);
    expect(read.detail).toBe("PowerPoint · 2 slides");
    expect(read.text).toContain("## Slide 1\nOpening slide\nmore\n\n## Slide 2\nMoved to second\nmore");
  });
});

describe("OpenDocument", () => {
  it("reads a spreadsheet's repeated cells and rows without writing thousands of blanks", async () => {
    const content = `<office:document-content xmlns:office="o" xmlns:table="t" xmlns:text="x"><office:automatic-styles/><office:body><office:spreadsheet>
      <table:table table:name="Budget"><table:table-row><table:table-cell><text:p>Item</text:p></table:table-cell><table:table-cell table:number-columns-repeated="2"><text:p>x</text:p></table:table-cell><table:table-cell table:number-columns-repeated="1020"/></table:table-row>
      <table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="1024"/></table:table-row></table:table>
    </office:spreadsheet></office:body></office:document-content>`;
    const read = await extractDocument("ods", "budget.ods", zipArchive({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content }), 50_000, noPdf);
    expect(read.detail).toBe("OpenDocument · 1 sheet");
    expect(read.text.endsWith("## Sheet: Budget\nItem,x,x")).toBe(true);
  });

  it("reads a text document's paragraphs and spaces", async () => {
    const content = `<office:document-content xmlns:office="o" xmlns:text="x"><office:body><office:text><text:h>Title</text:h><text:p>one<text:s text:c="3"/>two<text:tab/>three</text:p></office:text></office:body></office:document-content>`;
    const read = await extractDocument("odt", "note.odt", zipArchive({ "content.xml": content }), 50_000, noPdf);
    expect(read.text).toContain("Title\none   two\tthree");
  });
});

describe("PDF", () => {
  it("reads each page's lines with the real PDF reader", async () => {
    const pdf = textPdf([["Hello PDF world"], ["Second page", "with two lines"]]);
    const read = await extractDocument("pdf", "brief.pdf", pdf, 50_000, nodePdf);
    expect(read.detail).toBe("PDF · 2 pages");
    expect(read.text).toMatch(/--- Page 1 ---\nHello PDF world\n\n--- Page 2 ---\nSecond page\s*\n\s*with two lines/);
  });

  it("says a scanned PDF has no text instead of sending an empty file", async () => {
    await expect(extractDocument("pdf", "scan.pdf", textPdf([[], []]), 50_000, nodePdf)).rejects.toThrow(/scan\.pdf has no text to read - it looks like scanned pages/);
  });

  it("stops reading pages at the limit and says which it read", async () => {
    const pages = Array.from({ length: 5 }, (_, index) => [`Page number ${index + 1} has words on it`]);
    const read = await extractDocument("pdf", "long.pdf", textPdf(pages), 40, nodePdf);
    expect(read.detail).toBe("PDF · 2 of 5 pages");
  });
});
