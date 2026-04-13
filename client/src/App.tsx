import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DealList from "./pages/DealList";
import DealDetail from "./pages/DealDetail";
import ReviewQueue from "./pages/ReviewQueue";
import ActiveDeals from "./pages/ActiveDeals";
import DealDatabase from "./pages/DealDatabase";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function NavItem({ to, label, icon, end }: { to: string; label: string; icon: React.ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-medium transition-colors ${
          isActive ? "bg-black text-white" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-56 shrink-0 bg-white border-r border-[#e5e5e5] flex flex-col overflow-y-auto">
        <div className="px-5 py-6">
          <h1 className="text-lg font-bold tracking-tight text-gray-900">Deal Automation</h1>
          <p className="text-xs text-gray-400 mt-1">CRM Pipeline Dashboard</p>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          <NavItem to="/" end label="Review" icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          } />
          <NavItem to="/active" label="Active Deals" icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          } />
          <NavItem to="/database" label="Deal Database" icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
            </svg>
          } />
        </nav>
        <div className="px-5 py-4 border-t border-[#e5e5e5]">
          <p className="text-xs text-gray-400">v1.0.0</p>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-[#f5f5f5]">
        <div className="max-w-7xl mx-auto px-6 py-8">{children}</div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<DealList />} />
            <Route path="/active" element={<ActiveDeals />} />
            <Route path="/deals/:id" element={<DealDetail />} />
            <Route path="/database" element={<DealDatabase />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
