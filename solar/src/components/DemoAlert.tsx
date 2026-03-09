"use client";

interface DemoLimits {
  hourly_limit: number;
  daily_limit: number;
  hourly_remaining: number;
  daily_remaining: number;
  lifetime_limit?: number | null;
  lifetime_remaining?: number | null;
}

interface DemoAlertProps {
  error: string;
  status?: number;
  retryAfter?: string;
  limits?: DemoLimits | null;
  onDismiss?: () => void;
}

export default function DemoAlert({ error, status, retryAfter, limits, onDismiss }: DemoAlertProps) {
  const isRateLimit = status === 429;
  const isPageLimit = status === 403;
  const isUnavailable = status === 503;

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
          {isRateLimit ? (
            <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-amber-800">
            {isRateLimit ? "Demo Rate Limit Reached" :
             isPageLimit ? "Demo Page Limit" :
             isUnavailable ? "Demo Temporarily Unavailable" :
             "Demo Access Limited"}
          </h4>
          <p className="text-sm text-amber-700 mt-1">{error}</p>
          {retryAfter && (
            <p className="text-xs text-amber-600 mt-1">Try again {retryAfter}.</p>
          )}
          {limits && (
            <div className="mt-2 flex gap-4 text-xs text-amber-600">
              <span>
                Hourly: {limits.hourly_remaining}/{limits.hourly_limit} remaining
              </span>
              <span>
                Daily: {limits.daily_remaining}/{limits.daily_limit} remaining
              </span>
              {limits.lifetime_limit != null && limits.lifetime_remaining != null && (
                <span>
                  Lifetime: {limits.lifetime_remaining}/{limits.lifetime_limit} remaining
                </span>
              )}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <a
              href="mailto:kenny@hyder.me?subject=SolarTrack Full Access Request"
              className="inline-flex items-center px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs font-semibold hover:bg-blue-700 transition"
            >
              Get Full Access
            </a>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="inline-flex items-center px-3 py-1.5 bg-white border border-amber-300 text-amber-700 rounded-md text-xs font-medium hover:bg-amber-50 transition"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
