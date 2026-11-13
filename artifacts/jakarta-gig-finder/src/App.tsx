import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import AdminPortal from "@/pages/admin";
import PrivasiPage from "@/pages/privasi";
import KlienPage, { getClientToken } from "@/pages/klien";

const queryClient = new QueryClient();

/** Halaman utama; bila ada ?klien=<token> tampilkan halaman klien agensi (tanpa login). */
function HomeOrKlien() {
  const token = getClientToken();
  return token ? <KlienPage token={token} /> : <Home />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeOrKlien} />
      <Route path="/admin" component={AdminPortal} />
      <Route path="/privasi" component={PrivasiPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
