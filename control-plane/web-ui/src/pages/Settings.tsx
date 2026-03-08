export function Settings() {
  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold">Settings</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Project Settings */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
          <h3 className="text-lg font-medium mb-4">Project Settings</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Default Model</label>
              <select className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200">
                <option value="claude-sonnet-4-20250514">Claude Sonnet 4 (Primary)</option>
                <option value="gpt-4.1-mini">GPT-4.1 Mini (Fast)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Max Concurrency</label>
              <input
                type="number"
                defaultValue={5}
                min={1}
                max={20}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Monthly Budget ($)</label>
              <input
                type="number"
                defaultValue={500}
                min={0}
                step={50}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
              />
            </div>
          </div>
        </div>

        {/* Security Settings */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
          <h3 className="text-lg font-medium mb-4">Security</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Production approval required</span>
              <input type="checkbox" defaultChecked className="rounded" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Level 3 command approval</span>
              <input type="checkbox" defaultChecked className="rounded" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Batch edit approval (&gt;10 files)</span>
              <input type="checkbox" defaultChecked className="rounded" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">External API approval</span>
              <input type="checkbox" className="rounded" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
