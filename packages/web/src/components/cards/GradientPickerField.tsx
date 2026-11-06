import { ArrowLeftRight } from 'lucide-react';
import ColorPickerField from './ColorPickerField';
import { StyleConfig } from '../../types/cardTemplate';

interface GradientPickerFieldProps {
  styles: StyleConfig;
  onChange: (patch: Partial<StyleConfig>) => void;
}

const GradientPickerField = ({ styles, onChange }: GradientPickerFieldProps) => {
  const preview = `${styles.backgroundGradientType}-gradient(${styles.backgroundGradientAngle}deg, ${styles.backgroundGradientFrom} ${styles.backgroundGradientFromStop}%, ${styles.backgroundGradientTo} ${styles.backgroundGradientToStop}%)`;

  const selectedHandleStyle = (stop: number) => ({
    left: `${stop}%`,
  });

  return (
    <div className="space-y-5 rounded-[20px] border border-slate-200 bg-[#f6f4f1] p-5">
      <div className="relative pt-7">
        <button
          type="button"
          className="absolute top-0 h-7 w-7 -translate-x-1/2 rounded-full border-2 border-white shadow"
          style={{
            ...selectedHandleStyle(styles.backgroundGradientFromStop),
            backgroundColor: styles.backgroundGradientFrom,
          }}
        />
        <button
          type="button"
          className="absolute top-0 h-7 w-7 -translate-x-1/2 rounded-full border-2 border-white shadow"
          style={{
            ...selectedHandleStyle(styles.backgroundGradientToStop),
            backgroundColor: styles.backgroundGradientTo,
          }}
        />
        <div className="h-5 rounded-full border border-slate-200" style={{ background: preview }} />
      </div>

      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div className="text-[1rem] text-slate-700">Flip</div>
        <button
          type="button"
          onClick={() =>
            onChange({
              backgroundGradientFrom: styles.backgroundGradientTo,
              backgroundGradientTo: styles.backgroundGradientFrom,
              backgroundGradientFromStop: styles.backgroundGradientToStop,
              backgroundGradientToStop: styles.backgroundGradientFromStop,
            })
          }
          className="rounded-xl p-2 text-slate-600 hover:bg-white"
        >
          <ArrowLeftRight size={18} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-5">
        <div className="space-y-2">
          <div className="text-[1rem] text-slate-700">Color</div>
          <ColorPickerField
            value={styles.backgroundGradientFrom}
            onChange={(color) => onChange({ backgroundGradientFrom: color })}
          />
        </div>
        <div className="space-y-2">
          <div className="text-[1rem] text-slate-700">Stop</div>
          <div className="grid grid-cols-[minmax(0,1fr)_56px] overflow-hidden rounded-2xl border border-slate-300 bg-white">
            <input
              type="number"
              min="0"
              max="100"
              value={styles.backgroundGradientFromStop}
              onChange={(event) =>
                onChange({ backgroundGradientFromStop: Number(event.target.value) })
              }
              className="h-11 w-full px-4 text-sm text-slate-700 outline-none"
            />
            <div className="flex items-center justify-center border-l border-slate-200 text-sm text-slate-500">%</div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[1rem] text-slate-700">Type</div>
          <select
            value={styles.backgroundGradientType}
            onChange={(event) =>
              onChange({ backgroundGradientType: event.target.value as StyleConfig['backgroundGradientType'] })
            }
            className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm text-slate-700 outline-none"
          >
            <option value="linear">Linear</option>
          </select>
        </div>
        <div className="space-y-2">
          <div className="text-[1rem] text-slate-700">Angle</div>
          <div className="grid grid-cols-[minmax(0,1fr)_64px] overflow-hidden rounded-2xl border border-slate-300 bg-white">
            <input
              type="number"
              value={styles.backgroundGradientAngle}
              onChange={(event) =>
                onChange({ backgroundGradientAngle: Number(event.target.value) })
              }
              className="h-11 w-full px-4 text-sm text-slate-700 outline-none"
            />
            <div className="flex items-center justify-center border-l border-slate-200 text-sm text-slate-500">DEG</div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[1rem] text-slate-700">End color</div>
          <ColorPickerField
            value={styles.backgroundGradientTo}
            onChange={(color) => onChange({ backgroundGradientTo: color })}
          />
        </div>
        <div className="space-y-2">
          <div className="text-[1rem] text-slate-700">End stop</div>
          <div className="grid grid-cols-[minmax(0,1fr)_56px] overflow-hidden rounded-2xl border border-slate-300 bg-white">
            <input
              type="number"
              min="0"
              max="100"
              value={styles.backgroundGradientToStop}
              onChange={(event) =>
                onChange({ backgroundGradientToStop: Number(event.target.value) })
              }
              className="h-11 w-full px-4 text-sm text-slate-700 outline-none"
            />
            <div className="flex items-center justify-center border-l border-slate-200 text-sm text-slate-500">%</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GradientPickerField;
