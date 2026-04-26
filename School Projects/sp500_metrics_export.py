from __future__ import annotations

import io
from pathlib import Path
from typing import Iterable

import pandas as pd
import requests
import yfinance as yf
from openpyxl.styles import Font


START_DATE = "2009-12-01"
END_DATE = "2025-12-31"
BENCHMARK_TICKER = "^GSPC"
CONSTITUENTS_URL = "https://datahub.io/core/s-and-p-500-companies/r/constituents.csv"
OUTPUT_FILE = "sp500_stock_metrics.xlsx"
TRADING_DAYS_PER_YEAR = 252
TRAILING_DAYS = 252
RISK_FREE_RATE = 0.0
DOWNLOAD_CHUNK_SIZE = 100
DOWNLOAD_END_DATE = (pd.Timestamp(END_DATE) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")

PERCENTAGE_COLUMNS = {
    "return_1y",
    "total_return_since_start",
    "annualized_return_since_start",
    "historical_volatility_1y",
    "historical_volatility_since_start",
    "dividend_yield_ttm",
}

CURRENCY_PER_SHARE_COLUMNS = {
    "latest_price",
    "total_dividends_since_start",
}

RATIO_COLUMNS = {
    "sharpe_ratio_1y",
    "sharpe_ratio_since_start",
    "beta_vs_sp500_1y",
    "beta_vs_sp500_since_start",
}

YEARS_COLUMNS = {"years_of_history"}


def chunked(items: list[str], size: int) -> Iterable[list[str]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def get_download_end_date(end_date: str) -> str:
    # yfinance treats `end` as exclusive, so add one calendar day.
    return (pd.Timestamp(end_date) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")


def normalize_download_frame(frame: pd.DataFrame, tickers: list[str]) -> pd.DataFrame:
    if isinstance(frame.columns, pd.MultiIndex):
        frame.columns = frame.columns.set_names(["Price", "Ticker"])
        return frame

    if len(tickers) != 1:
        raise ValueError("Expected multi-index columns when downloading multiple tickers.")

    frame.columns = pd.MultiIndex.from_product(
        [frame.columns, tickers],
        names=["Price", "Ticker"],
    )
    return frame


def fetch_sp500_constituents() -> pd.DataFrame:
    response = requests.get(CONSTITUENTS_URL, timeout=30)
    response.raise_for_status()
    constituents = pd.read_csv(io.StringIO(response.text))
    constituents = constituents.rename(
        columns={
            "Symbol": "symbol",
            "Security": "security",
            "GICS Sector": "sector",
            "GICS Sub-Industry": "sub_industry",
        }
    )
    constituents["yf_ticker"] = constituents["symbol"].str.replace(".", "-", regex=False)
    return constituents[["symbol", "yf_ticker", "security", "sector", "sub_industry"]]


def download_market_data(tickers: list[str], start: str, end: str) -> pd.DataFrame:
    batches: list[pd.DataFrame] = []

    for batch in chunked(tickers, DOWNLOAD_CHUNK_SIZE):
        batch_frame = yf.download(
            batch,
            start=start,
            end=end,
            interval="1d",
            auto_adjust=False,
            actions=True,
            progress=False,
            threads=True,
        )
        if batch_frame.empty:
            continue
        batches.append(normalize_download_frame(batch_frame, batch))

    if not batches:
        raise RuntimeError("No market data was downloaded.")

    combined = pd.concat(batches, axis=1)
    combined = combined.loc[:, ~combined.columns.duplicated()]
    combined = combined.sort_index(axis=1)
    return combined


def extract_field(frame: pd.DataFrame, field: str) -> pd.DataFrame:
    if field not in frame.columns.get_level_values("Price"):
        return pd.DataFrame(index=frame.index)
    field_frame = frame.xs(field, axis=1, level="Price")
    if isinstance(field_frame, pd.Series):
        field_frame = field_frame.to_frame()
    return field_frame.sort_index(axis=1)


def last_valid_value(series: pd.Series) -> float:
    valid = series.dropna()
    if valid.empty:
        return float("nan")
    return float(valid.iloc[-1])


def first_valid_value(series: pd.Series) -> float:
    valid = series.dropna()
    if valid.empty:
        return float("nan")
    return float(valid.iloc[0])


def calculate_period_return(prices: pd.DataFrame, start_date: pd.Timestamp, end_date: pd.Timestamp) -> pd.Series:
    # Price return over a fixed window using adjusted close data.
    end_prices = prices.apply(lambda column: column.asof(end_date))
    start_prices = prices.apply(lambda column: column.asof(start_date))
    return end_prices.divide(start_prices) - 1


def calculate_beta(stock_returns: pd.Series, benchmark_returns: pd.Series, window: int | None = None) -> float:
    # Beta is covariance(stock, benchmark) divided by variance(benchmark).
    joined = pd.concat([stock_returns, benchmark_returns], axis=1, join="inner").dropna()
    if window is not None:
        joined = joined.tail(window)
    if len(joined) < 2:
        return float("nan")

    benchmark_variance = joined.iloc[:, 1].var()
    if pd.isna(benchmark_variance) or benchmark_variance == 0:
        return float("nan")

    return float(joined.iloc[:, 0].cov(joined.iloc[:, 1]) / benchmark_variance)


def calculate_sharpe_ratio(stock_returns: pd.Series, risk_free_rate: float, window: int | None = None) -> float:
    # Annualized Sharpe ratio from daily excess returns.
    trailing = stock_returns.dropna()
    if window is not None:
        trailing = trailing.tail(window)
    if len(trailing) < 2:
        return float("nan")

    daily_risk_free = risk_free_rate / TRADING_DAYS_PER_YEAR
    excess_returns = trailing - daily_risk_free
    volatility = excess_returns.std()
    if pd.isna(volatility) or volatility == 0:
        return float("nan")

    return float((excess_returns.mean() / volatility) * (TRADING_DAYS_PER_YEAR**0.5))


def calculate_historical_volatility(stock_returns: pd.Series, window: int | None = None) -> float:
    # Annualized volatility from the standard deviation of daily returns.
    trailing = stock_returns.dropna()
    if window is not None:
        trailing = trailing.tail(window)
    if len(trailing) < 2:
        return float("nan")
    return float(trailing.std() * (TRADING_DAYS_PER_YEAR**0.5))


def calculate_summary_metrics(
    prices: pd.DataFrame,
    close_prices: pd.DataFrame,
    dividends: pd.DataFrame,
    benchmark_ticker: str,
    analysis_start_date: str | pd.Timestamp | None = None,
    analysis_end_date: str | pd.Timestamp | None = None,
) -> pd.DataFrame:
    analysis_start_timestamp = pd.Timestamp(analysis_start_date or START_DATE)
    max_requested_end = pd.Timestamp(analysis_end_date or END_DATE)
    returns = prices.pct_change(fill_method=None)
    benchmark_returns = returns[benchmark_ticker]
    stock_prices = prices.drop(columns=benchmark_ticker, errors="ignore")
    stock_returns = returns.drop(columns=benchmark_ticker, errors="ignore")
    stock_closes = close_prices.drop(columns=benchmark_ticker, errors="ignore")
    stock_dividends = dividends.drop(columns=benchmark_ticker, errors="ignore")

    analysis_end_timestamp = min(max_requested_end, prices.index.max())
    one_year_start = analysis_end_timestamp - pd.DateOffset(years=1)

    stock_prices = stock_prices.loc[:analysis_end_timestamp]
    stock_returns = stock_returns.loc[:analysis_end_timestamp]
    stock_closes = stock_closes.loc[:analysis_end_timestamp]
    stock_dividends = stock_dividends.loc[:analysis_end_timestamp]
    benchmark_returns = benchmark_returns.loc[:analysis_end_timestamp]

    latest_prices = stock_prices.apply(lambda column: column.asof(analysis_end_timestamp))
    latest_close_prices = stock_closes.apply(last_valid_value)
    first_prices = stock_prices.apply(first_valid_value)

    first_dates = stock_prices.apply(lambda column: column.dropna().index.min())
    last_dates = stock_prices.apply(lambda column: column.dropna().index.max())
    years_of_history = (last_dates - first_dates).dt.days / 365.25

    total_return = latest_prices.divide(first_prices) - 1
    annualized_return = pd.Series(index=stock_prices.columns, dtype="float64")
    for ticker in stock_prices.columns:
        years = years_of_history.get(ticker)
        if pd.isna(years) or years <= 0:
            annualized_return.loc[ticker] = float("nan")
            continue
        # CAGR over the stock's full available history inside the analysis window.
        annualized_return.loc[ticker] = (latest_prices.loc[ticker] / first_prices.loc[ticker]) ** (1 / years) - 1

    trailing_dividends = stock_dividends.loc[stock_dividends.index > one_year_start].sum()
    dividend_yield_ttm = trailing_dividends.divide(latest_close_prices).replace([pd.NA, pd.NaT], pd.NA)
    total_dividends_since_start = stock_dividends.sum()

    trailing_return_1y = calculate_period_return(stock_prices, one_year_start, analysis_end_timestamp)

    sharpe_ratio_1y = stock_returns.apply(
        lambda column: calculate_sharpe_ratio(column, risk_free_rate=RISK_FREE_RATE, window=TRAILING_DAYS)
    )
    sharpe_ratio_since_start = stock_returns.apply(
        lambda column: calculate_sharpe_ratio(column, risk_free_rate=RISK_FREE_RATE)
    )
    historical_volatility_1y = stock_returns.apply(
        lambda column: calculate_historical_volatility(column, window=TRAILING_DAYS)
    )
    historical_volatility_since_start = stock_returns.apply(calculate_historical_volatility)
    beta_1y = stock_returns.apply(lambda column: calculate_beta(column, benchmark_returns, window=TRAILING_DAYS))
    beta_since_start = stock_returns.apply(lambda column: calculate_beta(column, benchmark_returns))

    summary = pd.DataFrame(
        {
            "window_start_date": analysis_start_timestamp,
            "window_end_date": analysis_end_timestamp,
            "latest_price": latest_prices,
            "return_1y": trailing_return_1y,
            "total_return_since_start": total_return,
            "annualized_return_since_start": annualized_return,
            "sharpe_ratio_1y": sharpe_ratio_1y,
            "sharpe_ratio_since_start": sharpe_ratio_since_start,
            "historical_volatility_1y": historical_volatility_1y,
            "historical_volatility_since_start": historical_volatility_since_start,
            "beta_vs_sp500_1y": beta_1y,
            "beta_vs_sp500_since_start": beta_since_start,
            "dividend_yield_ttm": dividend_yield_ttm,
            "total_dividends_since_start": total_dividends_since_start,
        }
    )

    summary["history_start_date"] = first_dates.astype("datetime64[ns]")
    summary["history_end_date"] = last_dates.astype("datetime64[ns]")
    summary["years_of_history"] = years_of_history
    summary.index.name = "yf_ticker"
    return summary.reset_index()


def build_metric_definitions() -> pd.DataFrame:
    definitions = [
        {
            "metric": "latest_price",
            "formula": "latest adjusted close price at window_end_date",
            "unit": "USD per share",
            "display_in_excel": "currency",
            "notes": "Pulled from adjusted close data after forward fill.",
        },
        {
            "metric": "return_1y",
            "formula": "(adjusted_close_end / adjusted_close_1y_ago) - 1",
            "unit": "decimal return",
            "display_in_excel": "percentage",
            "notes": "Example: 0.125 = 12.5% 1-year price return.",
        },
        {
            "metric": "total_return_since_start",
            "formula": "(adjusted_close_end / adjusted_close_first_available) - 1",
            "unit": "decimal return",
            "display_in_excel": "percentage",
            "notes": "Uses each stock's first available adjusted close inside the analysis window.",
        },
        {
            "metric": "annualized_return_since_start",
            "formula": "(adjusted_close_end / adjusted_close_first_available)^(1 / years_of_history) - 1",
            "unit": "decimal annual return",
            "display_in_excel": "percentage",
            "notes": "This is CAGR.",
        },
        {
            "metric": "sharpe_ratio_1y",
            "formula": "sqrt(252) * mean(daily_return - rf_daily) / std(daily_return - rf_daily) using last 252 trading days",
            "unit": "ratio",
            "display_in_excel": "number",
            "notes": "Risk-free rate is currently set to 0.0.",
        },
        {
            "metric": "sharpe_ratio_since_start",
            "formula": "sqrt(252) * mean(daily_return - rf_daily) / std(daily_return - rf_daily) using full sample",
            "unit": "ratio",
            "display_in_excel": "number",
            "notes": "Dimensionless risk-adjusted return measure.",
        },
        {
            "metric": "historical_volatility_1y",
            "formula": "std(daily_return over last 252 trading days) * sqrt(252)",
            "unit": "decimal annualized volatility",
            "display_in_excel": "percentage",
            "notes": "Example: 0.20 = 20% annualized volatility.",
        },
        {
            "metric": "historical_volatility_since_start",
            "formula": "std(daily_return over full sample) * sqrt(252)",
            "unit": "decimal annualized volatility",
            "display_in_excel": "percentage",
            "notes": "Full-period annualized volatility.",
        },
        {
            "metric": "beta_vs_sp500_1y",
            "formula": "cov(stock_daily_return, sp500_daily_return) / var(sp500_daily_return) using last 252 trading days",
            "unit": "ratio",
            "display_in_excel": "number",
            "notes": "Benchmark is ^GSPC.",
        },
        {
            "metric": "beta_vs_sp500_since_start",
            "formula": "cov(stock_daily_return, sp500_daily_return) / var(sp500_daily_return) using full sample",
            "unit": "ratio",
            "display_in_excel": "number",
            "notes": "Dimensionless market sensitivity measure.",
        },
        {
            "metric": "dividend_yield_ttm",
            "formula": "sum(dividends paid over trailing 12 months) / latest unadjusted close price",
            "unit": "decimal yield",
            "display_in_excel": "percentage",
            "notes": "Example: 0.03 = 3% trailing dividend yield.",
        },
        {
            "metric": "total_dividends_since_start",
            "formula": "sum(all cash dividends per share from start date through end date)",
            "unit": "USD per share",
            "display_in_excel": "currency",
            "notes": "Cumulative dividends per share, not total company cash paid.",
        },
        {
            "metric": "years_of_history",
            "formula": "(history_end_date - history_start_date).days / 365.25",
            "unit": "years",
            "display_in_excel": "number",
            "notes": "Elapsed time covered by each stock's available history.",
        },
    ]
    return pd.DataFrame(definitions)


def auto_fit_columns(worksheet) -> None:
    for column_cells in worksheet.columns:
        max_length = 0
        column_letter = column_cells[0].column_letter
        for cell in column_cells:
            cell_value = "" if cell.value is None else str(cell.value)
            max_length = max(max_length, len(cell_value))
        worksheet.column_dimensions[column_letter].width = min(max_length + 2, 60)


def apply_header_style(worksheet) -> None:
    for cell in worksheet[1]:
        cell.font = Font(bold=True)


def apply_metrics_number_formats(worksheet, header_row: int = 1) -> None:
    header_to_col = {cell.value: cell.column for cell in worksheet[header_row] if cell.value}
    for header, column_index in header_to_col.items():
        if header in PERCENTAGE_COLUMNS:
            number_format = "0.00%"
        elif header in CURRENCY_PER_SHARE_COLUMNS:
            number_format = '$#,##0.00'
        elif header in RATIO_COLUMNS:
            number_format = "0.000"
        elif header in YEARS_COLUMNS:
            number_format = "0.00"
        elif header.endswith("_date") or header in {"window_start_date", "window_end_date", "history_start_date", "history_end_date"}:
            number_format = "yyyy-mm-dd"
        else:
            continue

        for row in worksheet.iter_rows(min_row=header_row + 1, min_col=column_index, max_col=column_index):
            for cell in row:
                cell.number_format = number_format


def build_output_frames(
    constituents: pd.DataFrame,
    summary_metrics: pd.DataFrame,
    available_tickers: set[str],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    metrics_sheet = constituents.merge(summary_metrics, on="yf_ticker", how="left").sort_values(
        by=["annualized_return_since_start", "symbol"],
        ascending=[False, True],
        na_position="last",
    )

    missing_tickers = constituents.loc[~constituents["yf_ticker"].isin(available_tickers), ["symbol", "yf_ticker", "security"]]
    return metrics_sheet, missing_tickers


def export_to_excel(
    metrics_sheet: pd.DataFrame,
    metric_definitions: pd.DataFrame,
    missing_tickers: pd.DataFrame,
    output_path: Path,
) -> Path:
    candidate_paths = [output_path, output_path.with_stem(f"{output_path.stem}_updated")]

    for candidate_path in candidate_paths:
        try:
            with pd.ExcelWriter(candidate_path, engine="openpyxl") as writer:
                metrics_sheet.to_excel(writer, sheet_name="metrics", index=False)
                metric_definitions.to_excel(writer, sheet_name="metric_definitions", index=False)
                missing_tickers.to_excel(writer, sheet_name="missing_tickers", index=False)

                apply_header_style(writer.sheets["metrics"])
                apply_header_style(writer.sheets["metric_definitions"])
                apply_header_style(writer.sheets["missing_tickers"])

                apply_metrics_number_formats(writer.sheets["metrics"])
                auto_fit_columns(writer.sheets["metrics"])
                auto_fit_columns(writer.sheets["metric_definitions"])
                auto_fit_columns(writer.sheets["missing_tickers"])
            return candidate_path
        except PermissionError:
            continue

    raise PermissionError(
        f"Could not write to {output_path.name} or {output_path.with_stem(f'{output_path.stem}_updated').name}. "
        "Please close the workbook and run the script again."
    )


def main() -> None:
    output_path = Path(__file__).with_name(OUTPUT_FILE)
    constituents = fetch_sp500_constituents()

    tickers = constituents["yf_ticker"].tolist()
    raw_market_data = download_market_data(tickers + [BENCHMARK_TICKER], start=START_DATE, end=DOWNLOAD_END_DATE)

    adjusted_close = extract_field(raw_market_data, "Adj Close").ffill()
    close_prices = extract_field(raw_market_data, "Close").ffill()
    dividends = extract_field(raw_market_data, "Dividends").fillna(0.0)

    required_fields = {"Adj Close", "Close", "Dividends"}
    present_fields = set(raw_market_data.columns.get_level_values("Price"))
    missing_fields = required_fields - present_fields
    if missing_fields:
        raise RuntimeError(f"Missing required data fields from yfinance: {sorted(missing_fields)}")

    if BENCHMARK_TICKER not in adjusted_close.columns:
        raise RuntimeError(f"Benchmark ticker {BENCHMARK_TICKER} was not returned by yfinance.")

    available_tickers = set(adjusted_close.columns) - {BENCHMARK_TICKER}
    summary_metrics = calculate_summary_metrics(
        prices=adjusted_close,
        close_prices=close_prices,
        dividends=dividends,
        benchmark_ticker=BENCHMARK_TICKER,
        analysis_start_date=START_DATE,
        analysis_end_date=END_DATE,
    )

    metrics_sheet, missing_tickers = build_output_frames(
        constituents=constituents,
        summary_metrics=summary_metrics,
        available_tickers=available_tickers,
    )
    metric_definitions = build_metric_definitions()

    exported_path = export_to_excel(
        metrics_sheet=metrics_sheet,
        metric_definitions=metric_definitions,
        missing_tickers=missing_tickers,
        output_path=output_path,
    )

    print(f"Exported workbook to: {exported_path}")


if __name__ == "__main__":
    main()
