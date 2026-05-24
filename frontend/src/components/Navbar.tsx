import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { LogOut, TrendingUp } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import api from "../api/axios";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm font-medium transition ${
    isActive
      ? "text-emerald-400"
      : "text-slate-400 hover:text-white"
  }`;

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [portfolioValue, setPortfolioValue] = useState<number | null>(null);

  const fetchPortfolioValue = useCallback(async () => {
    try {
      const { data } = await api.get<{ total_portfolio_value: number }>(
        "/portfolio"
      );
      setPortfolioValue(data.total_portfolio_value);
    } catch {
      setPortfolioValue(null);
    }
  }, []);

  useEffect(() => {
    fetchPortfolioValue();
    const interval = setInterval(fetchPortfolioValue, 60_000);
    return () => clearInterval(interval);
  }, [fetchPortfolioValue]);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-900/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            </div>
            <span className="font-semibold tracking-tight text-white">
              PaperTrade
            </span>
          </Link>

          <nav className="flex gap-4">
            <NavLink to="/dashboard" className={navLinkClass}>
              Dashboard
            </NavLink>
            <NavLink to="/trade" className={navLinkClass}>
              Trade
            </NavLink>
            <NavLink to="/watchlist" className={navLinkClass}>
              Watchlist
            </NavLink>
          </nav>
        </div>

        <div className="flex items-center gap-3 sm:gap-4">
          <div className="hidden text-right sm:block">
            <p className="text-xs text-slate-500">{user?.username}</p>
            <p className="font-mono text-sm font-medium text-white">
              {portfolioValue != null
                ? currency.format(portfolioValue)
                : "—"}
            </p>
          </div>
          <div className="sm:hidden">
            <p className="font-mono text-xs font-medium text-white">
              {portfolioValue != null
                ? currency.format(portfolioValue)
                : "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-600 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
}
