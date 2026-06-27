"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Setup() {
  const router = useRouter();
  const [form, setForm] = useState({
    raceName: "",
    raceDate: "",
    distance: "half marathon",
    terrain: "flat",
    expectedConditions: "mild",
    goalTime: "",
    startDate: new Date().toISOString().slice(0, 10),
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/race-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    router.push("/dashboard");
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <h1 className="mb-6 text-2xl font-semibold">Tell us about your race</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Race name
          <input
            required
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
            value={form.raceName}
            onChange={(e) => setForm({ ...form, raceName: e.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Race date
          <input
            required
            type="date"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 [color-scheme:light] dark:[color-scheme:dark]"
            value={form.raceDate}
            onChange={(e) => setForm({ ...form, raceDate: e.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Distance
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            value={form.distance}
            onChange={(e) => setForm({ ...form, distance: e.target.value })}
          >
            <option>5k</option>
            <option>10k</option>
            <option>half marathon</option>
            <option>marathon</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Course terrain
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            value={form.terrain}
            onChange={(e) =>
              setForm({
                ...form,
                terrain: e.target.value as "flat" | "rolling" | "hilly" | "mountainous" | "trail",
              })
            }
          >
            <option value="flat">Flat</option>
            <option value="rolling">Rolling hills</option>
            <option value="hilly">Hilly</option>
            <option value="mountainous">Mountainous</option>
            <option value="trail">Trail / off-road</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Expected race-day conditions
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            value={form.expectedConditions}
            onChange={(e) =>
              setForm({
                ...form,
                expectedConditions: e.target.value as "mild" | "hot" | "humid" | "cold" | "variable",
              })
            }
          >
            <option value="mild">Mild</option>
            <option value="hot">Hot</option>
            <option value="humid">Hot &amp; humid</option>
            <option value="cold">Cold</option>
            <option value="variable">Variable / not sure yet</option>
          </select>
          <span className="text-xs text-slate-400">Just a best guess for now - you can update this closer to race day.</span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Goal finish time
          <input
            placeholder="e.g. 2:40:00"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
            value={form.goalTime}
            onChange={(e) => setForm({ ...form, goalTime: e.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Training start date
          <input
            type="date"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 [color-scheme:light] dark:[color-scheme:dark]"
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          />
        </label>

        <button
          type="submit"
          disabled={saving}
          className="mt-2 rounded-lg bg-orange-600 px-6 py-3 font-medium text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save and view dashboard"}
        </button>
      </form>
    </main>
  );
}
