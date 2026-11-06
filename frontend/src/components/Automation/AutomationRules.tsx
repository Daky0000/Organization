import React, { useState } from "react";
import type { AutomationIntegration, AutomationRule } from "../../hooks/useAutomation";
import { Modal } from "../ui/Modal";

const triggerOptions = [
  { value: "POST_CREATED", label: "Post Created" },
  { value: "TIME_BASED", label: "Time Based" },
  { value: "MANUAL", label: "Manual" },
];

const actionOptions = [
  { value: "AUTO_POST", label: "Auto Post" },
  { value: "SCHEDULE", label: "Schedule" },
  { value: "NOTIFY", label: "Notify" },
];

type Props = {
  rules: AutomationRule[];
  availableIntegrations: AutomationIntegration[];
  onCreate: (payload: any) => Promise<void>;
  onApply?: (ruleId: string) => void;
};

export const AutomationRules: React.FC<Props> = ({
  rules,
  availableIntegrations,
  onCreate,
  onApply,
}) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState("POST_CREATED");
  const [actionType, setActionType] = useState("AUTO_POST");
  const [executeTime, setExecuteTime] = useState("09:00");
  const [selectedIntegrations, setSelectedIntegrations] = useState<string[]>([]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setTriggerType("POST_CREATED");
    setActionType("AUTO_POST");
    setExecuteTime("09:00");
    setSelectedIntegrations([]);
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    await onCreate({
      name,
      description,
      triggerType,
      actionType,
      selectedIntegrations,
      executeTime,
    });
    resetForm();
    setOpen(false);
  };

  const toggleIntegration = (id: string) => {
    setSelectedIntegrations((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-100">Automation Rules</h3>
          <p className="text-xs text-slate-400">
            Reusable workflows for consistent publishing.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-xs font-semibold text-white"
        >
          + Create New Rule
        </button>
      </div>

      <div className="space-y-3">
        {rules.length ? (
          rules.map((rule) => (
            <div
              key={rule.id}
              className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">
                    {rule.name}
                  </div>
                  <div className="text-xs text-slate-400">
                    {rule.description || "No description"}
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    Trigger: {rule.triggerType} · Action: {rule.actionType}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onApply?.(rule.id)}
                    className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                  >
                    Use
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-500"
                    disabled
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-500"
                    disabled
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
            No automation rules yet.
          </div>
        )}
      </div>

      <Modal
        open={open}
        title="Create Automation Rule"
        size="md"
        onClose={() => setOpen(false)}
      >
        <div className="space-y-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rule name"
            className="w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            rows={3}
            className="w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm"
          />
          <div className="grid gap-3 md:grid-cols-2">
            <select
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm"
            >
              {triggerOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm"
            >
              {actionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <input
            type="time"
            value={executeTime}
            onChange={(e) => setExecuteTime(e.target.value)}
            className="w-40 rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm"
          />
          <div>
            <div className="text-xs font-semibold text-slate-400">
              Select Platforms
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {availableIntegrations.map((integration) => (
                <label
                  key={integration.id}
                  className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={selectedIntegrations.includes(integration.id)}
                    onChange={() => toggleIntegration(integration.id)}
                  />
                  <span>
                    {integration.platform} · {integration.accountName}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs text-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="rounded-lg bg-indigo-500 px-4 py-2 text-xs text-white"
            >
              Save Rule
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
