export const FORECAST_HORIZONS = [7, 14, 30, 60, 90] as const;
export type ForecastHorizon = (typeof FORECAST_HORIZONS)[number];
