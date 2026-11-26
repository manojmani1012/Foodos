"""A report as a table, written out as CSV, Excel or PDF.

Money is held in paise and written in rupees: two decimals of text in CSV and
PDF, real numbers in Excel so they can be summed. Text that a spreadsheet would
run as a formula is defused.
"""

import csv
import datetime
import io
from dataclasses import dataclass, field
from typing import Any, Optional

from fpdf import FPDF
from fpdf.fonts import FontFace
from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter

TEXT, COUNT, MONEY, DATE = "text", "count", "money", "date"

MEDIA_TYPES = {
    "csv": "text/csv; charset=utf-8",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pdf": "application/pdf",
}

# A PDF past this many rows is hundreds of pages: Excel or CSV suits it.
MAX_PDF_ROWS = 3000


@dataclass
class Column:
    title: str
    kind: str = TEXT
    # Left out of the PDF, where the page is only so wide.
    pdf: bool = True
    # Whether the totals line adds this column up (money and counts only).
    total: bool = True


@dataclass
class Table:
    name: str
    title: str
    columns: list[Column]
    rows: list[list[Any]] = field(default_factory=list)


def rupees(paise: Any) -> str:
    paise = int(paise or 0)
    sign = "-" if paise < 0 else ""
    paise = abs(paise)

    return f"{sign}{paise // 100}.{paise % 100:02d}"


def safe_text(value: Any) -> str:
    text = ILLEGAL_CHARACTERS_RE.sub("", "" if value is None else str(value))

    # A name like =HYPERLINK(...) must stay text when opened in a spreadsheet.
    return f"'{text}" if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def _plain(column: Column, value: Any) -> str:
    if value is None:
        return ""

    if column.kind == MONEY:
        return rupees(value)

    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()

    return str(value)


def totals(table: Table) -> Optional[list[Any]]:
    """The totals line, or None when there is nothing to add up."""
    adds = [column.total and column.kind in (MONEY, COUNT) for column in table.columns]

    if not table.rows or not any(adds):
        return None

    line = [sum(int(row[i] or 0) for row in table.rows) if adds[i] else None for i in range(len(table.columns))]
    line[0] = "Total"

    return line


def _total_cell(column: Column, value: Any) -> str:
    return value if isinstance(value, str) else _plain(column, value)


def to_csv(table: Table) -> bytes:
    """The rows alone, with no totals line, so the data can be re-used."""
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([column.title for column in table.columns])

    for row in table.rows:
        writer.writerow(
            [
                safe_text(value) if column.kind == TEXT else _plain(column, value)
                for column, value in zip(table.columns, row)
            ]
        )

    return out.getvalue().encode("utf-8")


def to_xlsx(table: Table, period: str) -> bytes:
    book = Workbook()
    sheet = book.active
    sheet.title = table.name[:31]
    sheet.append([column.title for column in table.columns])

    for cell in sheet[1]:
        cell.font = Font(bold=True)
        cell.alignment = Alignment(wrap_text=True, vertical="top")

    total = totals(table)
    lines = [*table.rows, total] if total else table.rows

    for number, row in enumerate(lines, start=2):
        for index, (column, value) in enumerate(zip(table.columns, row), start=1):
            cell = sheet.cell(row=number, column=index)

            if value is None:
                continue

            if column.kind == MONEY and not isinstance(value, str):
                cell.value = int(value) / 100
                cell.number_format = "#,##0.00"
            elif column.kind == COUNT and not isinstance(value, str):
                cell.value = int(value)
            elif column.kind == DATE and isinstance(value, datetime.date):
                cell.value = value
                cell.number_format = "dd-mmm-yyyy"
            else:
                cell.value = ILLEGAL_CHARACTERS_RE.sub("", str(value))
                # Always text, never a formula.
                cell.data_type = "s"

    if total:
        for cell in sheet[len(lines) + 1]:
            cell.font = Font(bold=True)

    for index, column in enumerate(table.columns, start=1):
        longest = max([len(column.title)] + [len(_plain(column, row[index - 1])) for row in table.rows[:500]])
        sheet.column_dimensions[get_column_letter(index)].width = min(40, max(10, longest + 2))

    sheet.freeze_panes = "A2"
    book.properties.title = f"{table.title} ({period})"
    out = io.BytesIO()
    book.save(out)

    return out.getvalue()


def pdf_text(value: str) -> str:
    """The built-in PDF font has Latin letters only; anything else shows as '?'."""
    return value.replace("₹", "Rs ").replace("−", "-").encode("cp1252", "replace").decode("cp1252")


class _Page(FPDF):
    def footer(self) -> None:
        self.set_y(-10)
        self.set_font("Helvetica", size=7)
        self.cell(0, 5, f"Page {self.page_no()} of {{nb}}", align="R")


def new_pdf(columns: int = 8) -> FPDF:
    pdf = _Page(orientation="L" if columns > 6 else "P", format="A3" if columns > 13 else "A4")
    pdf.core_fonts_encoding = "cp1252"
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.set_margins(10, 10, 10)
    pdf.add_page()

    return pdf


def pdf_heading(pdf: FPDF, text: str, size: int = 14, style: str = "B") -> None:
    pdf.set_font("Helvetica", style, size)
    pdf.multi_cell(0, size * 0.5, pdf_text(text), new_x="LMARGIN", new_y="NEXT")


def pdf_table(
    pdf: FPDF,
    titles: list[str],
    rows: list[list[str]],
    right: list[bool],
    widths: list[float],
    bold_last: bool = False,
    size: float = 7.5,
) -> None:
    pdf.set_font("Helvetica", size=size)

    with pdf.table(
        col_widths=tuple(widths),
        text_align=tuple("RIGHT" if is_right else "LEFT" for is_right in right),
        line_height=size * 0.55,
        # Room between the text and the ruled lines.
        padding=0.9,
        headings_style=FontFace(emphasis="BOLD", fill_color=(232, 243, 235)),
        borders_layout="HORIZONTAL_LINES",
    ) as drawn:
        for index, values in enumerate([titles, *rows]):
            line = drawn.row()
            style = FontFace(emphasis="BOLD") if bold_last and index == len(rows) else None

            for value in values:
                line.cell(pdf_text(value), style=style)


def to_pdf(table: Table, period: str, company: str) -> bytes:
    keep = [i for i, column in enumerate(table.columns) if column.pdf]
    columns = [table.columns[i] for i in keep]
    lines = [[_plain(column, row[i]) for column, i in zip(columns, keep)] for row in table.rows[:MAX_PDF_ROWS]]
    total = totals(table)

    if total:
        line = ["" if total[i] is None else _total_cell(column, total[i]) for column, i in zip(columns, keep)]
        # The first column may be one the PDF leaves out.
        line[0] = line[0] or "Total"
        lines.append(line)

    pdf = new_pdf(len(columns))
    pdf_heading(pdf, f"{company}: {table.title}")
    pdf_heading(pdf, f"{period}. Amounts in rupees. {len(table.rows)} rows.", 9, "")
    pdf.ln(2)

    if len(table.rows) > MAX_PDF_ROWS:
        pdf_heading(
            pdf, f"Only the first {MAX_PDF_ROWS} rows are printed. The totals cover all rows. Use Excel or CSV.", 9
        )

    if not table.rows:
        pdf_heading(pdf, "Nothing in this period.", 10, "")
    else:
        # Wider columns for the ones with longer words in them.
        widths = [
            min(28, max([7, len(column.title) * 0.6] + [len(line[n]) for line in lines[:200]]))
            for n, column in enumerate(columns)
        ]
        pdf_table(
            pdf,
            [column.title for column in columns],
            lines,
            [column.kind in (MONEY, COUNT) for column in columns],
            widths,
            bold_last=bool(total),
            size=6.5 if len(columns) > 13 else 7.5,
        )

    return bytes(pdf.output())
