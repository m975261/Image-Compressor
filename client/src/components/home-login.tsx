import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Lock, FileIcon } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface HomeLoginProps {
  children: React.ReactNode;
}

export function HomeLogin({ children }: HomeLoginProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const sessionQuery = useQuery<{ authenticated: boolean }>({
    queryKey: ["/api/home/session"],
  });

  const loginMutation = useMutation({
    mutationFn: async (password: string) => {
      const response = await apiRequest("POST", "/api/home/login", { password });
      return response.json();
    },
    onSuccess: () => {
      setError(null);
      setPassword("");
      queryClient.invalidateQueries({ queryKey: ["/api/home/session"] });
    },
    onError: (err: any) => {
      setError(err.message || "Login failed");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password) {
      loginMutation.mutate(password);
    }
  };

  if (sessionQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (sessionQuery.data?.authenticated) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <FileIcon className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">File Tools</CardTitle>
          <p className="text-sm text-muted-foreground">
            Enter password to access the tools
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter admin password"
                  className="pl-10"
                  autoFocus
                  data-testid="input-home-password"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="text-login-error">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={!password || loginMutation.isPending}
              data-testid="button-home-login"
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Authenticating...
                </>
              ) : (
                "Access Tools"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
