"""
scripts/import-bls-oews-states.py: write lib/salary-guide-bls-states.data.ts
from the BLS Occupational Employment and Wage Statistics (OEWS) files.

Run once a year, after BLS publishes the next May reference period (spring):

    python -I scripts/import-bls-oews-states.py <state_MYYYY_dl.xlsx> <national_MYYYY_dl.xlsx> [--api-crosscheck]

The two xlsx files come from https://www.bls.gov/oes/tables.htm ("State" and
"National" downloads, special-requests/oesmYYst.zip and oesmYYnat.zip). Keep
them OUTSIDE the repo: the raw files are never committed, only the generated
module is. Run with python -I (isolated mode), because the files are
downloaded data.

What it extracts, for the 50 states and DC (territories are dropped):
    29-1171 Nurse Practitioners: employment, hourly median, annual 10th, 25th,
            50th, 75th and 90th percentile wages, and the annual mean (stored
            for completeness, never rendered: the site publishes medians).
    29-1071 Physician Assistants and 29-1141 Registered Nurses: employment,
            hourly median and annual median (the NP vs PA and NP vs RN
            comparisons).
plus the national row of each occupation from the national file.

Honesty rules the generator enforces:
    - A cell BLS printed as a footnote marker ("#" top-coded, "*" or "**" not
      available) is written verbatim and is never turned into a number.
    - A blank or unreadable cell stops the run: nothing is guessed.
    - Exactly 51 rows per occupation, cross-industry (NAICS 000000), all
      ownerships (OWN_CODE 1235), detailed occupation, or the run stops.
    - Where both are numbers, the annual median must sit within $20 of the
      hourly median times 2,080 hours (BLS derives one from the other), which
      catches a shifted column.
    - --api-crosscheck re-reads every state's NP and PA annual median from the
      BLS Public Data API (v2 with BLS_API_KEY from the environment, else v1)
      and stops on any mismatch. The header records the result.

Needs openpyxl (python -I uses the interpreter's own site-packages).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.request
from pathlib import Path

try:
    import openpyxl
except ImportError:  # pragma: no cover - a setup error, reported plainly
    sys.exit("openpyxl is required: python -m pip install openpyxl")

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "lib" / "salary-guide-bls-states.data.ts"

STATE_CODES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
    "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC",
    "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL",
    "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
    "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR",
    "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
    "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA",
    "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}

OCCUPATIONS = {
    "np": ("29-1171", "Nurse Practitioners"),
    "pa": ("29-1071", "Physician Assistants"),
    "rn": ("29-1141", "Registered Nurses"),
}

# Column order of the generated rows, per occupation key.
NP_FIELDS = ["TOT_EMP", "H_MEDIAN", "A_PCT10", "A_PCT25", "A_MEDIAN", "A_PCT75", "A_PCT90", "A_MEAN"]
SHORT_FIELDS = ["TOT_EMP", "H_MEDIAN", "A_MEDIAN"]
HOURLY_FIELDS = {"H_MEDIAN"}
FOOTNOTE_MARKERS = {"#", "*", "**"}
HOURS_PER_YEAR = 2080
ANNUAL_FROM_HOURLY_TOLERANCE = 20


def fail(message: str) -> None:
    sys.exit(f"import-bls-oews-states: {message}")


def read_rows(path: Path, occ_codes: set[str]):
    """Yield every row of the first sheet whose OCC_CODE is wanted, as a dict."""
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook[workbook.sheetnames[0]]
    header = None
    for row in sheet.iter_rows(values_only=True):
        if header is None:
            header = [str(cell).strip().upper() if cell is not None else "" for cell in row]
            continue
        record = dict(zip(header, row))
        if str(record.get("OCC_CODE", "")).strip() in occ_codes:
            yield record


def cell_text(record: dict, field: str, where: str) -> str:
    """The cell as BLS printed it: a canonical number, or a footnote marker verbatim."""
    value = record.get(field)
    if isinstance(value, str):
        text = value.strip()
        if text in FOOTNOTE_MARKERS:
            return text
        try:
            value = float(text.replace(",", ""))
        except ValueError:
            fail(f"{where} {field}: unreadable cell {value!r}")
    if isinstance(value, bool) or value is None:
        fail(f"{where} {field}: blank cell (BLS prints a marker for a missing figure, so a blank is a read error)")
    if not isinstance(value, (int, float)):
        fail(f"{where} {field}: unexpected cell type {type(value).__name__}")
    if field in HOURLY_FIELDS:
        return f"{float(value):.2f}"
    if float(value) != int(value):
        fail(f"{where} {field}: expected a whole number, got {value!r}")
    return str(int(value))


def check_scope(record: dict, where: str) -> None:
    if str(record.get("NAICS", "")).strip() != "000000":
        fail(f"{where}: NAICS {record.get('NAICS')!r} is not cross-industry")
    if str(record.get("OWN_CODE", "")).strip() != "1235":
        fail(f"{where}: OWN_CODE {record.get('OWN_CODE')!r} is not all ownerships")
    if str(record.get("O_GROUP", "")).strip().lower() != "detailed":
        fail(f"{where}: O_GROUP {record.get('O_GROUP')!r} is not a detailed occupation")


def check_annual_vs_hourly(fields: list[str], values: list[str], where: str) -> None:
    by_field = dict(zip(fields, values))
    hourly, annual = by_field.get("H_MEDIAN"), by_field.get("A_MEDIAN")
    if hourly in FOOTNOTE_MARKERS or annual in FOOTNOTE_MARKERS or hourly is None or annual is None:
        return
    if abs(float(hourly) * HOURS_PER_YEAR - int(annual)) > ANNUAL_FROM_HOURLY_TOLERANCE:
        fail(f"{where}: annual median {annual} is not hourly median {hourly} x {HOURS_PER_YEAR} (a shifted column?)")


def extract_states(path: Path) -> dict[str, list[list[str]]]:
    wanted = {code for code, _ in OCCUPATIONS.values()}
    by_key: dict[str, dict[str, list[str]]] = {key: {} for key in OCCUPATIONS}
    for record in read_rows(path, wanted):
        state = str(record.get("AREA_TITLE", "")).strip()
        if str(record.get("AREA_TYPE", "")).strip() != "2" or state not in STATE_CODES:
            continue  # territories (Guam, Puerto Rico, Virgin Islands)
        occ = str(record["OCC_CODE"]).strip()
        key = next(k for k, (code, _) in OCCUPATIONS.items() if code == occ)
        where = f"{state} {occ}"
        check_scope(record, where)
        if str(record.get("PRIM_STATE", "")).strip() != STATE_CODES[state]:
            fail(f"{where}: PRIM_STATE {record.get('PRIM_STATE')!r} does not match {STATE_CODES[state]}")
        if state in by_key[key]:
            fail(f"{where}: duplicate row")
        fields = NP_FIELDS if key == "np" else SHORT_FIELDS
        values = [cell_text(record, field, where) for field in fields]
        check_annual_vs_hourly(fields, values, where)
        fips = str(record.get("AREA", "")).strip().zfill(2)
        by_key[key][state] = [state, STATE_CODES[state], fips, *values]
    out: dict[str, list[list[str]]] = {}
    for key, rows in by_key.items():
        missing = sorted(set(STATE_CODES) - set(rows))
        if missing or len(rows) != 51:
            fail(f"{OCCUPATIONS[key][0]}: expected 51 rows, got {len(rows)}; missing {missing}")
        out[key] = [rows[name] for name in sorted(rows)]
    return out


def extract_national(path: Path) -> dict[str, list[str]]:
    wanted = {code for code, _ in OCCUPATIONS.values()}
    out: dict[str, list[str]] = {}
    for record in read_rows(path, wanted):
        if str(record.get("AREA_TYPE", "")).strip() != "1":
            continue
        occ = str(record["OCC_CODE"]).strip()
        key = next(k for k, (code, _) in OCCUPATIONS.items() if code == occ)
        where = f"U.S. {occ}"
        check_scope(record, where)
        if key in out:
            fail(f"{where}: duplicate national row")
        values = [cell_text(record, field, where) for field in NP_FIELDS]
        check_annual_vs_hourly(NP_FIELDS, values, where)
        out[key] = values
    if set(out) != set(OCCUPATIONS):
        fail(f"national file: expected rows for {sorted(OCCUPATIONS)}, got {sorted(out)}")
    return out


def api_crosscheck(states: dict[str, list[list[str]]]) -> str:
    """Re-read every state's NP and PA annual median from the BLS API; stop on a mismatch."""
    key = os.environ.get("BLS_API_KEY", "").strip()
    version, batch = ("v2", 50) if key else ("v1", 25)
    url = f"https://api.bls.gov/publicAPI/{version}/timeseries/data/"
    expected: dict[str, str] = {}
    for occ_key in ("np", "pa"):
        soc = OCCUPATIONS[occ_key][0].replace("-", "")
        median_at = 3 + (NP_FIELDS if occ_key == "np" else SHORT_FIELDS).index("A_MEDIAN")
        for row in states[occ_key]:
            expected[f"OEUS{row[2]}00000000000{soc}13"] = row[median_at]
    year = str(REFERENCE_YEAR)
    series = sorted(expected)
    for start in range(0, len(series), batch):
        body = {"seriesid": series[start:start + batch], "startyear": year, "endyear": year}
        if key:
            body["registrationkey"] = key
        request = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8-sig"))
        if payload.get("status") != "REQUEST_SUCCEEDED":
            fail(f"BLS API: {payload.get('status')} {payload.get('message')}")
        for item in payload["Results"]["series"]:
            points = [p for p in item["data"] if p["year"] == year]
            got = points[0]["value"] if points else None
            if got != expected[item["seriesID"]]:
                fail(f"BLS API {item['seriesID']}: file says {expected[item['seriesID']]}, API says {got}")
    return (
        f"Cross-checked {dt.date.today().isoformat()} against the BLS Public Data API {version}: "
        f"all {len(series)} state annual medians (51 for 29-1171, 51 for 29-1071) match the file."
    )


REFERENCE_YEAR = 0  # set from the file name in main()


def ts_rows(rows: list[list[str]]) -> str:
    return "\n".join("    [" + ", ".join(json.dumps(cell) for cell in row) + "]," for row in rows)


def render(states, national, state_file: Path, national_file: Path, crosscheck: str | None) -> str:
    year = REFERENCE_YEAR
    yy = str(year)[-2:]
    np_row = national["np"]
    crosscheck_line = crosscheck or "Not run for this file: run the generator with --api-crosscheck."
    header = f'''/**
 * lib/salary-guide-bls-states.data.ts: GENERATED by
 * scripts/import-bls-oews-states.py on {dt.date.today().isoformat()}. Do not edit by hand:
 * re-run the generator on the next OEWS release instead.
 *
 * SOURCE: U.S. Bureau of Labor Statistics, Occupational Employment and Wage
 * Statistics (OEWS), May {year} estimates, public domain.
 *   State file:    {state_file.name} (https://www.bls.gov/oes/special-requests/oesm{yy}st.zip)
 *   National file: {national_file.name} (https://www.bls.gov/oes/special-requests/oesm{yy}nat.zip)
 * Rows: the 50 states and DC (AREA_TYPE 2; Guam, Puerto Rico and the Virgin
 * Islands dropped), cross-industry (NAICS 000000), all ownerships (OWN_CODE
 * 1235), detailed occupations 29-1171, 29-1071 and 29-1141.
 *
 * CHECKS the generator ran: 51 rows per occupation; every annual median
 * within ${ANNUAL_FROM_HOURLY_TOLERANCE} of the hourly median times {HOURS_PER_YEAR:,} hours; no blank cell.
 * {crosscheck_line}
 * National 29-1171 in this file: median {np_row[4]}, 10th percentile {np_row[2]}, 90th
 * percentile {np_row[6]} (tests/unit/salary-guide-bls-states.test.ts pins
 * these to STAT_SOURCES).
 *
 * FOOTNOTE MARKERS are kept verbatim and never become numbers: "#" means the
 * wage is top-coded (at or above the top of the BLS range), "*" or "**" means
 * BLS did not publish the estimate. lib/salary-guide-bls-states.ts parses
 * them to null with the reason attached.
 */
'''
    body = f'''
/** The vintage label every figure read from this module carries. */
export const BLS_OEWS_VINTAGE = 'May {year} OEWS, U.S. Bureau of Labor Statistics';

/** The reference period, as BLS names it. */
export const BLS_OEWS_REFERENCE_PERIOD = 'May {year}';

/** The reference period as an ISO month, the StatSource `asOf` format. */
export const BLS_OEWS_AS_OF = '{year}-05';

/** The day this module was generated from the files above. */
export const BLS_OEWS_GENERATED_ON = '{dt.date.today().isoformat()}';

/** The state and national download files this module was read from. */
export const BLS_OEWS_STATE_FILE_URL = 'https://www.bls.gov/oes/special-requests/oesm{yy}st.zip';
export const BLS_OEWS_NATIONAL_FILE_URL = 'https://www.bls.gov/oes/special-requests/oesm{yy}nat.zip';

/** Result of the BLS API cross-check, or null when it was not run. */
export const BLS_OEWS_API_CROSSCHECK: string | null = {json.dumps(crosscheck)};

/** Cells of every BLS_NP_STATE_ROWS row after state, code and FIPS. */
export const BLS_NP_FIELDS = {json.dumps(NP_FIELDS)} as const;

/** Cells of every BLS_PA_STATE_ROWS and BLS_RN_STATE_ROWS row after state, code and FIPS. */
export const BLS_SHORT_FIELDS = {json.dumps(SHORT_FIELDS)} as const;

/** 29-1171 Nurse Practitioners: [state, code, FIPS, ...BLS_NP_FIELDS]. */
export const BLS_NP_STATE_ROWS = [
{ts_rows(states["np"])}
] as const;

/** 29-1071 Physician Assistants: [state, code, FIPS, ...BLS_SHORT_FIELDS]. */
export const BLS_PA_STATE_ROWS = [
{ts_rows(states["pa"])}
] as const;

/** 29-1141 Registered Nurses: [state, code, FIPS, ...BLS_SHORT_FIELDS]. */
export const BLS_RN_STATE_ROWS = [
{ts_rows(states["rn"])}
] as const;

/** National rows, cells in BLS_NP_FIELDS order. */
export const BLS_NATIONAL_ROWS = {{
    np: {json.dumps(national["np"])},
    pa: {json.dumps(national["pa"])},
    rn: {json.dumps(national["rn"])},
}} as const;
'''
    return header + body


def main() -> None:
    global REFERENCE_YEAR
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("state_file", type=Path, help="state_MYYYY_dl.xlsx from the OEWS state download")
    parser.add_argument("national_file", type=Path, help="national_MYYYY_dl.xlsx from the OEWS national download")
    parser.add_argument("--api-crosscheck", action="store_true", help="re-read every state median from the BLS API")
    args = parser.parse_args()
    for path in (args.state_file, args.national_file):
        if not path.is_file():
            fail(f"not a file: {path}")
    stem = args.state_file.stem  # state_M2025_dl
    try:
        REFERENCE_YEAR = int(stem.split("_M")[1][:4])
    except (IndexError, ValueError):
        fail(f"cannot read the reference year from {args.state_file.name} (expected state_MYYYY_dl.xlsx)")
    if f"_M{REFERENCE_YEAR}" not in args.national_file.stem:
        fail(f"{args.national_file.name} is not the May {REFERENCE_YEAR} national file")

    states = extract_states(args.state_file)
    national = extract_national(args.national_file)
    crosscheck = api_crosscheck(states) if args.api_crosscheck else None
    OUT_PATH.write_text(render(states, national, args.state_file, args.national_file, crosscheck), encoding="utf-8", newline="\n")
    print(f"wrote {OUT_PATH.relative_to(REPO_ROOT)}: 51 rows x 3 occupations, May {REFERENCE_YEAR}")
    if crosscheck:
        print(crosscheck)


if __name__ == "__main__":
    main()
