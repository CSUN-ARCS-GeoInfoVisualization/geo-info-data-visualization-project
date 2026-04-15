import { useCallback, useEffect, useState } from "react";
import { Users, UserPlus, Shield, ShieldCheck, Search, Loader2, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { apiFetch } from "../services/api";

interface AdminUser {
  id: number;
  email: string;
  role: string;
  is_supreme: boolean;
  created_at: string | null;
}

interface RoleRequest {
  id: number;
  user_id: number;
  email: string;
  requested_role: string;
  reason: string | null;
  status: string;
  created_at: string | null;
}

interface Stats {
  total_users: number;
  role_counts: Record<string, number>;
  recent_signups_7d: number;
}

const ROLE_COLORS: Record<string, string> = {
  Admin: "bg-red-100 text-red-700 border-red-200",
  Researcher: "bg-blue-100 text-blue-700 border-blue-200",
  Resident: "bg-green-100 text-green-700 border-green-200",
};

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [roleRequests, setRoleRequests] = useState<RoleRequest[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, sRes, rRes] = await Promise.all([
        apiFetch("/admin/users"),
        apiFetch("/admin/stats"),
        apiFetch("/admin/role-requests"),
      ]);
      if (uRes.ok) setUsers(await uRes.json());
      if (sRes.ok) setStats(await sRes.json());
      if (rRes.ok) setRoleRequests(await rRes.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const changeRole = async (userId: number, role: string) => {
    const r = await apiFetch("/admin/assign-role", {
      method: "POST",
      body: JSON.stringify({ userId, role }),
    });
    if (r.ok) load();
    else {
      const d = await r.json().catch(() => ({}));
      alert(d.error || "Failed to change role");
    }
  };

  const handleRequest = async (reqId: number, action: "approve" | "deny") => {
    const r = await apiFetch(`/admin/role-requests/${reqId}/${action}`, { method: "POST" });
    if (r.ok) load();
  };

  const filtered = users.filter(
    (u) => u.email.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-1">Manage users, roles, and access requests</p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-6 text-center">
              <Users className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <div className="text-2xl font-bold">{stats.total_users}</div>
              <div className="text-sm text-muted-foreground">Total Users</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-2xl font-bold text-green-600">{stats.role_counts.Resident || 0}</div>
              <div className="text-sm text-muted-foreground">Residents</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-2xl font-bold text-blue-600">{stats.role_counts.Researcher || 0}</div>
              <div className="text-sm text-muted-foreground">Researchers</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="text-2xl font-bold text-red-600">{stats.role_counts.Admin || 0}</div>
              <div className="text-sm text-muted-foreground">Admins</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <UserPlus className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <div className="text-2xl font-bold">{stats.recent_signups_7d}</div>
              <div className="text-sm text-muted-foreground">New (7d)</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Role Requests */}
      {roleRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Pending Role Requests ({roleRequests.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {roleRequests.map((rr) => (
                <div key={rr.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{rr.email}</div>
                    <div className="text-sm text-muted-foreground">
                      Requesting: <Badge variant="outline" className={ROLE_COLORS[rr.requested_role] || ""}>{rr.requested_role}</Badge>
                    </div>
                    {rr.reason && (
                      <div className="text-sm text-muted-foreground mt-1 italic">"{rr.reason}"</div>
                    )}
                  </div>
                  <div className="flex gap-2 ml-4 shrink-0">
                    <Button size="sm" variant="outline" className="text-green-600" onClick={() => handleRequest(rr.id, "approve")}>
                      <CheckCircle className="h-4 w-4 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="text-red-600" onClick={() => handleRequest(rr.id, "deny")}>
                      <XCircle className="h-4 w-4 mr-1" /> Deny
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* User Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" /> User Management
            </CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 text-sm font-medium">Email</th>
                  <th className="text-left p-3 text-sm font-medium">Role</th>
                  <th className="text-left p-3 text-sm font-medium">Joined</th>
                  <th className="text-right p-3 text-sm font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/30">
                    <td className="p-3 text-sm">{u.email}</td>
                    <td className="p-3">
                      <Badge variant="outline" className={ROLE_COLORS[u.role] || ""}>
                        {u.role}
                      </Badge>
                      {u.is_supreme && (
                        <Badge variant="outline" className="ml-2 bg-yellow-100 text-yellow-700 border-yellow-200">
                          Supreme
                        </Badge>
                      )}
                    </td>
                    <td className="p-3 text-sm text-muted-foreground">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="p-3 text-right">
                      {u.is_supreme ? (
                        <span className="text-sm text-muted-foreground">Protected</span>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">Change Role</Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {["Resident", "Researcher", "Admin"].map((role) => (
                              <DropdownMenuItem
                                key={role}
                                disabled={role === u.role}
                                onSelect={() => changeRole(u.id, role)}
                              >
                                <Badge variant="outline" className={`mr-2 ${ROLE_COLORS[role]}`}>{role}</Badge>
                                {role === u.role ? "(Current)" : ""}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">No users found</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
