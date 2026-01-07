import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import TempDriveShare from "@/pages/temp-drive-share";
import FilePreview from "@/pages/file-preview";
import { HomeLogin } from "@/components/home-login";

function AuthenticatedRouter() {
  return (
    <HomeLogin>
      <Home />
    </HomeLogin>
  );
}

function Router() {
  const [location] = useLocation();
  
  if (location.startsWith("/temp-drive/share/")) {
    return (
      <Switch>
        <Route path="/temp-drive/share/:token" component={TempDriveShare} />
      </Switch>
    );
  }

  if (location.startsWith("/files/preview/")) {
    return (
      <Switch>
        <Route path="/files/preview/:fileId" component={FilePreview} />
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/" component={AuthenticatedRouter} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
