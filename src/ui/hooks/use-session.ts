import { useEffect, useState } from 'react';
import { bus } from '../../shared/events.ts';
import type { PermissionMode } from '../../permissions/types.ts';
import type { IrisMessage } from '../context.ts';
import { useIris } from '../context.ts';

interface SessionSnapshot {
  messages: IrisMessage[];
  model: string;
  mode: PermissionMode;
  isStreaming: boolean;
  isBusy: boolean;
}

export function useSession(): SessionSnapshot {
  const iris = useIris();
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() => readSnapshot(iris));

  useEffect(() => {
    const sync = () => setSnapshot(readSnapshot(iris));
    const offFns = [
      bus.on('agent:start', sync),
      bus.on('agent:done', sync),
      bus.on('tool:call', sync),
      bus.on('tool:result', sync),
      bus.on('cost:update', sync),
      bus.on('config:reloaded', sync),
    ];

    return () => {
      offFns.forEach((off) => off());
    };
  }, [iris]);

  return snapshot;
}

function readSnapshot(iris: ReturnType<typeof useIris>): SessionSnapshot {
  return {
    messages: iris.runtime.messagesRef.current,
    model: iris.runtime.modelRef.current,
    mode: iris.runtime.modeRef.current,
    isStreaming: iris.runtime.isStreamingRef.current,
    isBusy: iris.runtime.isBusyRef.current,
  };
}
