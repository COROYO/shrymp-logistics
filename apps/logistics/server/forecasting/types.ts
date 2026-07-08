export type ForecastMethod =
  | "HOLT_WINTERS"
  | "CROSTON"
  | "MOVING_AVERAGE"
  | "NONE";

/** Output of a single fitted model over a daily demand series. */
export type ModelFit = {
  /** Point forecast per future day, index 0 = tomorrow. Never negative. */
  dailyForecast: number[];
  /** Std deviation of one-step-ahead errors (uncertainty per day). */
  sigmaDaily: number;
  /** Mean absolute one-step-ahead error over the fit window, if computed. */
  oneStepMae: number | null;
};

export type EngineResult = {
  method: ForecastMethod;
  dailyForecast: number[];
  sigmaDaily: number;
  /** Holdout backtest MAE (last 14 days), when history allows it. */
  backtestMae: number | null;
  /** Mean units/day over the trailing 28 observed days (demand rate). */
  avgDailyUnits: number;
  historyDays: number;
  nonzeroDays: number;
  historyTotalUnits: number;
};
