/**
 * Sidebar — Timelapse.
 *
 * Plays the placed aerial photos in chronological order, one at a time, as a
 * temporal fly-through of the same area across years. The user sets either the
 * duration of EACH frame or the TOTAL duration of the sequence.
 */
import Section from './Section.jsx';

export default function TimelapseSection({ timelapse, onChange, frames }) {
  const count = frames.length;
  const set = (patch) => onChange({ ...timelapse, ...patch });

  const perImage =
    timelapse.mode === 'total'
      ? count > 0
        ? (timelapse.totalSec / count).toFixed(1)
        : '—'
      : timelapse.perImageSec;

  return (
    <Section title="Timelapse" defaultOpen={false}>
      <label className="flex cursor-pointer items-center justify-between">
        <span className="text-xs font-medium text-slate-200">Enable timelapse</span>
        <input
          type="checkbox"
          checked={timelapse.enabled}
          onChange={(e) => set({ enabled: e.target.checked, playing: false, index: 0 })}
          className="h-4 w-4 accent-sky-500"
        />
      </label>

      {timelapse.enabled && (
        <>
          {count < 2 ? (
            <p className="text-[11px] leading-relaxed text-amber-300/90">
              Add and place at least two photos of the same area (different
              years) to play a timelapse.
            </p>
          ) : (
            <>
              {/* duration mode */}
              <div className="rounded-md border border-slate-700/60 bg-slate-950/40 p-2">
                <div className="flex gap-2 text-[11px] text-slate-300">
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="radio"
                      name="tl-mode"
                      checked={timelapse.mode === 'perImage'}
                      onChange={() => set({ mode: 'perImage' })}
                      className="accent-sky-500"
                    />
                    Per image
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="radio"
                      name="tl-mode"
                      checked={timelapse.mode === 'total'}
                      onChange={() => set({ mode: 'total' })}
                      className="accent-sky-500"
                    />
                    Total length
                  </label>
                </div>
                <label className="mt-2 flex items-center gap-2 text-[10px] text-slate-400">
                  {timelapse.mode === 'total' ? 'Total seconds' : 'Seconds / image'}
                  <input
                    type="number"
                    min="0.2"
                    step="0.1"
                    value={timelapse.mode === 'total' ? timelapse.totalSec : timelapse.perImageSec}
                    onChange={(e) =>
                      set(
                        timelapse.mode === 'total'
                          ? { totalSec: Math.max(0.2, Number(e.target.value)) }
                          : { perImageSec: Math.max(0.2, Number(e.target.value)) }
                      )
                    }
                    className="w-20 rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-[11px] text-slate-200 focus:border-sky-500 focus:outline-none"
                  />
                  <span className="text-slate-500">
                    {timelapse.mode === 'total' ? `≈ ${perImage}s each` : `≈ ${(perImage * count).toFixed(1)}s total`}
                  </span>
                </label>
                <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-400">
                  <input
                    type="checkbox"
                    checked={timelapse.loop}
                    onChange={(e) => set({ loop: e.target.checked })}
                    className="h-3.5 w-3.5 accent-sky-500"
                  />
                  Loop
                </label>
              </div>

              {/* transport */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => set({ index: Math.max(0, timelapse.index - 1), playing: false })}
                  className="rounded bg-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-600"
                  title="Previous"
                >
                  ⏮
                </button>
                <button
                  onClick={() => set({ playing: !timelapse.playing })}
                  className="flex-1 rounded bg-sky-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-500"
                >
                  {timelapse.playing ? '⏸ Pause' : '▶ Play'}
                </button>
                <button
                  onClick={() => set({ index: Math.min(count - 1, timelapse.index + 1), playing: false })}
                  className="rounded bg-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-600"
                  title="Next"
                >
                  ⏭
                </button>
              </div>

              {/* scrubber */}
              <input
                type="range"
                min="0"
                max={count - 1}
                step="1"
                value={Math.min(timelapse.index, count - 1)}
                onChange={(e) => set({ index: Number(e.target.value), playing: false })}
                className="w-full"
              />
              <p className="text-center text-[11px] text-slate-300">
                {frames[Math.min(timelapse.index, count - 1)]?.label} · frame{' '}
                {Math.min(timelapse.index, count - 1) + 1} / {count}
              </p>
            </>
          )}
        </>
      )}
    </Section>
  );
}
