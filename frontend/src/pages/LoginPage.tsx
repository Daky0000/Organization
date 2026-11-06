import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const isLoading = useAuthStore((state) => state.isLoading);

  const [formData, setFormData] = useState({
    identifier: "",
    password: "",
  });
  const [error, setError] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      await login(formData.identifier, formData.password);
      navigate("/dashboard");
    } catch (err: any) {
      setError(err.response?.data?.error || "Login failed");
    }
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center px-6 py-12">
        <div className="grid w-full gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-500 via-purple-500 to-sky-500 p-10 text-white shadow-xl">
            <div className="absolute top-6 left-6">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 text-2xl font-bold text-white">
                *
              </span>
            </div>

            <div className="relative mt-16 space-y-6">
              <h1 className="text-4xl font-bold tracking-tight">Welcome back</h1>
              <p className="max-w-sm text-base text-white/80">
                Access your tasks, notes, and projects anytime, anywhere — and keep everything flowing in one place.
              </p>

              <div className="mt-6 rounded-2xl bg-white/10 p-6 backdrop-blur">
                <p className="text-sm font-semibold text-white/90">Quick stats</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-white/10 p-4">
                    <p className="text-sm text-white/70">Total posts</p>
                    <p className="mt-1 text-xl font-semibold">42</p>
                  </div>
                  <div className="rounded-xl bg-white/10 p-4">
                    <p className="text-sm text-white/70">Engagement</p>
                    <p className="mt-1 text-xl font-semibold">4.3%</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-slate-950/40 to-transparent" />
          </div>

          <div className="flex items-center justify-center">
            <div className="w-full max-w-md rounded-3xl bg-white p-10 shadow-xl">
              <h2 className="text-2xl font-bold text-slate-900">Log in</h2>
              <p className="mt-2 text-sm text-slate-500">
                Use your email or username to continue.
              </p>

              {error && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Email or username</span>
                  <input
                    type="text"
                    name="identifier"
                    value={formData.identifier}
                    onChange={handleChange}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    required
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Password</span>
                  <input
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    required
                  />
                </label>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoading ? "Loading..." : "Get Started"}
                </button>
              </form>

              <div className="mt-6 flex items-center justify-between text-xs text-slate-400">
                <span>or continue with</span>
                <span className="text-slate-500">Quick access</span>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  <span className="text-base">𝐁</span>
                  Behance
                </button>
                <button
                  type="button"
                  className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  <span className="text-base">G</span>
                  Google
                </button>
                <button
                  type="button"
                  className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  <span className="text-base">f</span>
                  Facebook
                </button>
              </div>

              <p className="mt-6 text-center text-sm text-slate-500">
                Don&apos;t have an account?{" "}
                <a href="/signup" className="text-indigo-600 font-semibold hover:underline">
                  Create an account
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
