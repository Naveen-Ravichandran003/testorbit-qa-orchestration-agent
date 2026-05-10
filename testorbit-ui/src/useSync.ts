import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { getCredentials } from "./jiraService";

const SOCKET_URL = "http://localhost:3001";

export interface SyncUser { name: string; color: string; }
export interface PresenceUser extends SyncUser { page: string; boardId: string | null; socketId: string; }
export interface ActivityEntry {
  id?: number; project_key: string; board_id?: string | null;
  user_name: string; user_color: string; action: string; detail?: string | null; ts: string;
}

// Singleton socket — one connection per browser tab regardless of how many components use the hook
let _socket: Socket | null = null;
let _refCount = 0;

function getSocket(): Socket {
  if (!_socket || !_socket.connected) {
    _socket = io(SOCKET_URL, { reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: Infinity });
  }
  return _socket;
}

// Generate a stable per-tab user identity stored in sessionStorage
function getUser(): SyncUser {
  const stored = sessionStorage.getItem("testorbit_sync_user");
  if (stored) return JSON.parse(stored);
  const colors = ["#6366f1","#10b981","#f59e0b","#ef4444","#3b82f6","#8b5cf6","#ec4899","#14b8a6"];
  const creds = getCredentials();
  const name = creds?.email?.split("@")[0] || `Tester-${Math.floor(Math.random() * 900 + 100)}`;
  const color = colors[Math.floor(Math.random() * colors.length)];
  const user = { name, color };
  sessionStorage.setItem("testorbit_sync_user", JSON.stringify(user));
  return user;
}

interface UseSyncOptions {
  page: string;
  boardId?: string | null;
  onPresence?: (users: PresenceUser[]) => void;
  onActivity?: (entry: ActivityEntry) => void;
  onActivityHistory?: (entries: ActivityEntry[]) => void;
  onBoardState?: (rows: any[]) => void;
  onRowUpdated?: (rowId: string, patch: any, by: SyncUser) => void;
  onRowEditing?: (rowId: string, user: SyncUser) => void;
  onBoardPeers?: (count: number) => void;
  onBoardReset?: () => void;
}

export function useSync(opts: UseSyncOptions) {
  const socketRef = useRef<Socket | null>(null);
  const optsRef   = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const creds = getCredentials();
    if (!creds?.projectKey) return;

    _refCount++;
    const socket = getSocket();
    socketRef.current = socket;
    const user = getUser();

    function on<T>(event: string, handler: (data: T) => void) {
      socket.on(event, handler);
      return () => socket.off(event, handler);
    }

    const offs = [
      on<PresenceUser[]>("presence",         d => optsRef.current.onPresence?.(d)),
      on<ActivityEntry> ("activity",         d => optsRef.current.onActivity?.(d)),
      on<ActivityEntry[]>("activity_history",d => optsRef.current.onActivityHistory?.(d)),
      on<any[]>         ("board_state",      d => optsRef.current.onBoardState?.(d)),
      on<any>           ("row_updated",      d => optsRef.current.onRowUpdated?.(d.rowId, d.patch, d.by)),
      on<any>           ("row_editing",      d => optsRef.current.onRowEditing?.(d.rowId, d.user)),
      on<number>        ("board_peers",      d => optsRef.current.onBoardPeers?.(d)),
      on<void>          ("board_reset",      () => optsRef.current.onBoardReset?.()),
    ];

    // Only emit identify once per socket connection, not on every hook mount
    if (_refCount === 1 || !socket.connected) {
      socket.emit("identify", { projectKey: creds.projectKey, user });
    }
    socket.emit("page_change", { page: opts.page });

    // Join board room if boardId provided
    if (opts.boardId) socket.emit("join_board", { boardId: opts.boardId });

    // Re-identify on reconnect
    const onReconnect = () => {
      socket.emit("identify", { projectKey: creds.projectKey, user });
      socket.emit("page_change", { page: optsRef.current.page });
      if (optsRef.current.boardId) socket.emit("join_board", { boardId: optsRef.current.boardId });
    };
    socket.on("connect", onReconnect);

    return () => {
      offs.forEach(off => off());
      socket.off("connect", onReconnect);
      _refCount--;
    };
  }, [opts.page, opts.boardId]);

  const emitRowUpdate = useCallback((boardId: string, rowId: string, patch: any) => {
    socketRef.current?.emit("row_update", { boardId, rowId, patch });
  }, []);

  const emitRowsLoaded = useCallback((boardId: string, rows: any[]) => {
    socketRef.current?.emit("rows_loaded", { boardId, rows });
  }, []);

  const emitJoinBoard = useCallback((boardId: string) => {
    socketRef.current?.emit("join_board", { boardId });
  }, []);

  const emitActivity = useCallback((action: string, detail?: string, boardId?: string) => {
    const creds = getCredentials();
    if (!creds?.projectKey) return;
    socketRef.current?.emit("activity", { projectKey: creds.projectKey, boardId, action, detail });
  }, []);

  const emitResetBoard = useCallback((boardId: string) => {
    socketRef.current?.emit("reset_board", { boardId });
  }, []);

  const emitPageChange = useCallback((page: string) => {
    socketRef.current?.emit("page_change", { page });
  }, []);

  return { emitRowUpdate, emitRowsLoaded, emitJoinBoard, emitActivity, emitResetBoard, emitPageChange, getUser };
}
