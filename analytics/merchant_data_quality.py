"""
Merchant Data Quality Analysis

Purpose:
    Perform basic data-quality checks and cleaning on an exported
    merchant form dataset.

Input:
    CSV file containing merchant form records.

Output:
    1. Cleaned CSV
    2. Data-quality summary CSV

No production/company data is included in this repository.
"""

from pathlib import Path
import argparse
import pandas as pd


EXPECTED_COLUMNS = [
    "customerName",
    "customerNumber",
    "location",
    "employeeName",
    "status",
    "brand",
    "tideProduct",
    "verificationStatus",
    "createdAt",
]


STATUS_MAP = {
    "ready for onboarding": "Ready for Onboarding",
    "not interested": "Not Interested",
    "try but not done due to error": "Try but not done due to error",
    "need to visit again": "Need to visit again",
}


def load_data(file_path: str) -> pd.DataFrame:
    """Load merchant data from CSV."""
    path = Path(file_path)

    if not path.exists():
        raise FileNotFoundError(f"Input file not found: {path}")

    return pd.read_csv(path)


def standardize_text_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Remove unnecessary spaces from text fields."""

    text_columns = df.select_dtypes(include="object").columns

    for column in text_columns:
        df[column] = (
            df[column]
            .astype("string")
            .str.strip()
            .replace({"": pd.NA})
        )

    return df


def standardize_status(df: pd.DataFrame) -> pd.DataFrame:
    """Standardize merchant onboarding status values."""

    if "status" not in df.columns:
        return df

    df["status"] = (
        df["status"]
        .astype("string")
        .str.strip()
        .str.lower()
        .map(STATUS_MAP)
        .fillna(df["status"])
    )

    return df


def standardize_dates(df: pd.DataFrame) -> pd.DataFrame:
    """Convert createdAt into a consistent datetime format."""

    if "createdAt" in df.columns:
        df["createdAt"] = pd.to_datetime(
            df["createdAt"],
            errors="coerce"
        )

    return df


def find_duplicate_records(df: pd.DataFrame) -> pd.DataFrame:
    """Identify possible duplicate merchant submissions."""

    available_keys = [
        column
        for column in ["customerNumber", "customerName"]
        if column in df.columns
    ]

    if not available_keys:
        return pd.DataFrame()

    duplicates = df[
        df.duplicated(
            subset=available_keys,
            keep=False
        )
    ].copy()

    return duplicates


def create_quality_report(df: pd.DataFrame) -> pd.DataFrame:
    """Create column-level data-quality metrics."""

    rows = []

    for column in df.columns:
        missing = int(df[column].isna().sum())
        unique = int(df[column].nunique(dropna=True))

        rows.append(
            {
                "column": column,
                "total_rows": len(df),
                "missing_values": missing,
                "missing_percentage": round(
                    (missing / len(df)) * 100, 2
                ) if len(df) else 0,
                "unique_values": unique,
            }
        )

    return pd.DataFrame(rows)


def main():
    parser = argparse.ArgumentParser(
        description="Clean and profile merchant form data."
    )

    parser.add_argument(
        "--input",
        required=True,
        help="Path to input CSV file"
    )

    parser.add_argument(
        "--output-dir",
        default="analytics/output",
        help="Directory for generated reports"
    )

    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print("Loading merchant data...")
    df = load_data(args.input)

    original_rows = len(df)

    print(f"Rows loaded: {original_rows}")

    missing_expected = [
        column
        for column in EXPECTED_COLUMNS
        if column not in df.columns
    ]

    if missing_expected:
        print(
            "Note: expected fields not present:",
            ", ".join(missing_expected)
        )

    # Cleaning
    df = standardize_text_columns(df)
    df = standardize_status(df)
    df = standardize_dates(df)

    # Duplicate analysis
    duplicates = find_duplicate_records(df)

    # Data quality report
    quality_report = create_quality_report(df)

    # Remove exact duplicate rows
    df = df.drop_duplicates()

    # Save outputs
    cleaned_file = output_dir / "merchant_data_cleaned.csv"
    quality_file = output_dir / "data_quality_report.csv"
    duplicate_file = output_dir / "possible_duplicates.csv"

    df.to_csv(cleaned_file, index=False)
    quality_report.to_csv(quality_file, index=False)

    if not duplicates.empty:
        duplicates.to_csv(duplicate_file, index=False)

    print("\nData quality analysis completed.")
    print(f"Original rows : {original_rows}")
    print(f"Final rows    : {len(df)}")
    print(f"Removed exact duplicates: {original_rows - len(df)}")
    print(f"Quality report: {quality_file}")

    if not duplicates.empty:
        print(f"Possible duplicates: {duplicate_file}")


if __name__ == "__main__":
    main()