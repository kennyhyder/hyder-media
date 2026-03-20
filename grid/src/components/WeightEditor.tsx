"use client";

import { useState, useEffect } from "react";
import {
  SCORE_FACTOR_KEYS,
  DEFAULT_WEIGHTS,
  PRESET_PROFILES,
  normalizedWeightPct,
  isCustomWeights,
  saveWeightProfile,
  loadWeightProfiles,
  deleteWeightProfile,
  type WeightProfile,
} from "@/lib/customScoring";

interface WeightEditorProps {
  weights: Record<string, number>;
  onChange: (weights: Record<string, number>) => void;
  /** Start collapsed? */
  defaultCollapsed?: boolean;
}

export default function WeightEditor({
  weights,
  onChange,
  defaultCollapsed = true,
}: WeightEditorProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [customProfiles, setCustomProfiles] = useState<WeightProfile[]>([]);
  const [saveName, setSaveName] = useState("");
  const [showSave, setShowSave] = useState(false);

  useEffect(() => {
    setCustomProfiles(loadWeightProfiles());
  }, []);

  const totalRaw = Object.values(weights).reduce((s, w) => s + w, 0);
  const hasCustom = isCustomWeights(weights);

  const handleSlider = (key: string, value: number) => {
    onChange({ ...weights, [key]: value });
  };

  const handleReset = () => {
    onChange({ ...DEFAULT_WEIGHTS });
  };

  const handlePreset = (profile: WeightProfile) => {
    onChange({ ...profile.weights });
  };

  const handleSave = () => {
    if (!saveName.trim()) return;
    saveWeightProfile(saveName.trim(), weights);
    setCustomProfiles(loadWeightProfiles());
    setSaveName("");
    setShowSave(false);
  };

  const handleDeleteProfile = (name: string) => {
    deleteWeightProfile(name);
    setCustomProfiles(loadWeightProfiles());
  };

  const allProfiles = [...PRESET_PROFILES, ...customProfiles];

  return (
    <div className="bg-white rounded-lg border border-gray-200 mb-6 print:hidden">
      {/* Toggle header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 rounded-lg"
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-purple-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
            />
          </svg>
          <span className="text-sm font-semibold text-gray-900">
            Custom Scoring Weights
          </span>
          {hasCustom && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
              Custom
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${collapsed ? "" : "rotate-180"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3">
          {/* Presets row */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs text-gray-500 font-medium">Presets:</span>
            {allProfiles.map((profile) => {
              const isBuiltIn = PRESET_PROFILES.some((p) => p.name === profile.name);
              return (
                <span key={profile.name} className="inline-flex items-center gap-0.5">
                  <button
                    onClick={() => handlePreset(profile)}
                    className="px-2.5 py-1 text-xs rounded border border-gray-200 hover:border-purple-300 hover:bg-purple-50 text-gray-700"
                  >
                    {profile.name}
                  </button>
                  {!isBuiltIn && (
                    <button
                      onClick={() => handleDeleteProfile(profile.name)}
                      className="text-gray-300 hover:text-red-500 text-xs px-0.5"
                      title="Delete profile"
                    >
                      &times;
                    </button>
                  )}
                </span>
              );
            })}
            <span className="text-gray-300">|</span>
            {showSave ? (
              <span className="inline-flex items-center gap-1">
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  placeholder="Profile name..."
                  className="px-2 py-1 text-xs border border-gray-300 rounded w-28 focus:ring-purple-500 focus:border-purple-500"
                  autoFocus
                />
                <button
                  onClick={handleSave}
                  disabled={!saveName.trim()}
                  className="px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => { setShowSave(false); setSaveName(""); }}
                  className="text-gray-400 hover:text-gray-600 text-xs"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setShowSave(true)}
                className="px-2.5 py-1 text-xs text-purple-600 hover:text-purple-800"
              >
                + Save Current
              </button>
            )}
            {hasCustom && (
              <>
                <span className="text-gray-300">|</span>
                <button
                  onClick={handleReset}
                  className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-800"
                >
                  Reset to Default
                </button>
              </>
            )}
          </div>

          {/* Sliders grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
            {SCORE_FACTOR_KEYS.map((factor) => {
              const rawVal = weights[factor.key] || 0;
              const normPct = normalizedWeightPct(factor.key, weights);
              const defaultVal = DEFAULT_WEIGHTS[factor.key] || 0;
              const isChanged = rawVal !== defaultVal;

              return (
                <div key={factor.key} className="flex items-center gap-2">
                  <span
                    className={`text-xs w-32 truncate ${isChanged ? "text-purple-700 font-medium" : "text-gray-600"}`}
                    title={factor.label}
                  >
                    {factor.label}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={rawVal}
                    onChange={(e) => handleSlider(factor.key, Number(e.target.value))}
                    className="flex-1 h-1.5 accent-purple-600 cursor-pointer"
                  />
                  <span className="text-xs text-gray-500 w-7 text-right font-mono">
                    {rawVal}
                  </span>
                  <span
                    className={`text-xs w-8 text-right font-mono ${isChanged ? "text-purple-600 font-medium" : "text-gray-400"}`}
                  >
                    {normPct}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Sum indicator */}
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
            <span>
              Raw total: {totalRaw} (auto-normalized to 100%)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
