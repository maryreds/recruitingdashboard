// Vercel Serverless Function — Export profile as Word document
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, TabStopPosition, TabStopType,
  ShadingType, convertInchesToTwip, Table, TableRow, TableCell,
  WidthType, VerticalAlign,
} = require('docx');

const NAVY = '001E52';
const RED = 'B6171E';
const GREY = '44464F';
const LIGHT_BG = 'F2F4F6';
const WHITE = 'FFFFFF';

function heading(text, level, opts = {}) {
  return new Paragraph({
    heading: level,
    spacing: { before: opts.before ?? 240, after: opts.after ?? 120 },
    ...opts.para,
    children: [
      new TextRun({
        text,
        bold: true,
        color: NAVY,
        font: 'Georgia',
        size: level === HeadingLevel.HEADING_1 ? 44 : level === HeadingLevel.HEADING_2 ? 24 : 20,
        ...opts.run,
      }),
    ],
  });
}

function bullet(text) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, font: 'Calibri', size: 19, color: '191C1E' })],
  });
}

function spacer(pts = 6) {
  return new Paragraph({ spacing: { after: pts * 20 }, children: [] });
}

function divider() {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E0E3E5' } },
    children: [],
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { profile: p } = req.body || {};
  if (!p || !p.name) return res.status(400).json({ error: 'Missing profile data' });

  try {
    const sections = [];

    // ── Name & Title ──
    sections.push(new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: p.name, bold: true, font: 'Georgia', size: 48, color: NAVY })],
    }));
    sections.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: p.title || '', font: 'Calibri', size: 22, color: '7287C1' })],
    }));

    // ── Contact line ──
    const contact = p.contact || {};
    const contactParts = [contact.email, contact.phone, contact.location].filter(Boolean);
    if (contactParts.length) {
      sections.push(new Paragraph({
        spacing: { after: 120 },
        children: contactParts.flatMap((part, i) => {
          const runs = [new TextRun({ text: part, font: 'Calibri', size: 18, color: GREY })];
          if (i < contactParts.length - 1) {
            runs.push(new TextRun({ text: '  |  ', font: 'Calibri', size: 18, color: 'C4C6D3' }));
          }
          return runs;
        }),
      }));
    }

    sections.push(divider());

    // ── Professional Summary ──
    if (p.summary) {
      sections.push(heading('Professional Summary', HeadingLevel.HEADING_2));
      sections.push(new Paragraph({
        spacing: { after: 160 },
        children: [new TextRun({ text: p.summary, font: 'Georgia', size: 20, italics: true, color: '191C1E' })],
      }));
      sections.push(divider());
    }

    // ── Key Intelligence (metrics) ──
    if (p.metrics && p.metrics.length) {
      sections.push(heading('Key Intelligence', HeadingLevel.HEADING_2, { after: 80 }));
      const metricCells = p.metrics.map(m => {
        return new TableCell({
          width: { size: 100 / p.metrics.length, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.SOLID, color: LIGHT_BG },
          margins: { top: 120, bottom: 120, left: 120, right: 120 },
          verticalAlign: VerticalAlign.CENTER,
          children: [
            new Paragraph({
              spacing: { after: 40 },
              children: [new TextRun({ text: m.value, bold: true, font: 'Georgia', size: 32, color: NAVY })],
            }),
            new Paragraph({
              children: [new TextRun({ text: m.label, font: 'Calibri', size: 16, color: GREY })],
            }),
          ],
        });
      });
      sections.push(new Table({
        rows: [new TableRow({ children: metricCells })],
        width: { size: 100, type: WidthType.PERCENTAGE },
      }));
      sections.push(spacer(10));
      sections.push(divider());
    }

    // ── Professional Experience ──
    if (p.experience && p.experience.length) {
      sections.push(heading('Professional Experience', HeadingLevel.HEADING_2));
      for (const exp of p.experience) {
        // Title + dates on same line
        sections.push(new Paragraph({
          spacing: { before: 160, after: 40 },
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
          children: [
            new TextRun({ text: exp.title, bold: true, font: 'Georgia', size: 22, color: NAVY }),
            new TextRun({ text: '\t', font: 'Calibri' }),
            new TextRun({ text: exp.dates || '', font: 'Calibri', size: 18, color: GREY }),
          ],
        }));
        // Company
        sections.push(new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({ text: exp.company, bold: true, font: 'Calibri', size: 18, color: '00327D' })],
        }));
        // Bullets
        for (const b of (exp.bullets || [])) {
          sections.push(bullet(b));
        }
      }
      sections.push(divider());
    }

    // ── Skills ──
    if (p.skills && p.skills.length) {
      sections.push(heading('Expertise', HeadingLevel.HEADING_2, { after: 80 }));
      sections.push(new Paragraph({
        spacing: { after: 120 },
        children: p.skills.flatMap((s, i) => {
          const runs = [new TextRun({
            text: s,
            bold: i < 2,
            font: 'Calibri',
            size: 19,
            color: i < 2 ? NAVY : '191C1E',
          })];
          if (i < p.skills.length - 1) {
            runs.push(new TextRun({ text: '  \u2022  ', font: 'Calibri', size: 19, color: 'C4C6D3' }));
          }
          return runs;
        }),
      }));
      sections.push(divider());
    }

    // ── Education ──
    if (p.education && p.education.length) {
      sections.push(heading('Education', HeadingLevel.HEADING_2, { after: 80 }));
      for (const ed of p.education) {
        sections.push(new Paragraph({
          spacing: { after: 20 },
          children: [new TextRun({ text: ed.degree, bold: true, font: 'Calibri', size: 20, color: NAVY })],
        }));
        sections.push(new Paragraph({
          spacing: { after: 100 },
          children: [new TextRun({ text: ed.school, font: 'Calibri', size: 18, color: GREY })],
        }));
      }
      sections.push(divider());
    }

    // ── Certifications ──
    if (p.certifications && p.certifications.length) {
      sections.push(heading('Credentials', HeadingLevel.HEADING_2, { after: 80 }));
      for (const cert of p.certifications) {
        sections.push(new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({ text: '\u2713  ', bold: true, font: 'Calibri', size: 19, color: NAVY }),
            new TextRun({ text: cert, font: 'Calibri', size: 19, color: '191C1E' }),
          ],
        }));
      }
      sections.push(spacer(8));
    }

    // ── Footer ──
    sections.push(new Paragraph({
      spacing: { before: 300 },
      alignment: AlignmentType.CENTER,
      border: { top: { style: BorderStyle.SINGLE, size: 1, color: 'E0E3E5' } },
      children: [new TextRun({
        text: `Curated by JSM Intelligence Systems \u2022 ${new Date().getFullYear()}`,
        font: 'Calibri', size: 14, color: '86898A', allCaps: true,
      })],
    }));

    const doc = new Document({
      styles: {
        default: {
          document: { run: { font: 'Calibri', size: 20 } },
        },
      },
      sections: [{
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.8),
              bottom: convertInchesToTwip(0.8),
              left: convertInchesToTwip(0.9),
              right: convertInchesToTwip(0.9),
            },
          },
        },
        children: sections,
      }],
    });

    const buffer = await Packer.toBuffer(doc);

    const safeName = (p.name || 'profile').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '-').toLowerCase();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-profile.docx"`);
    res.setHeader('Content-Length', buffer.length);
    return res.status(200).send(buffer);
  } catch (err) {
    console.error('DOCX export error:', err);
    return res.status(500).json({ error: 'Failed to generate document. ' + err.message });
  }
};
