import { useIris } from '../context.ts';

export function useAgent(): {
  sendMessage: (text: string) => Promise<void>;
  sendCommand: (text: string) => Promise<'handled' | 'passthrough'>;
  cancel: () => void;
  isRunning: boolean;
} {
  const iris = useIris();

  return {
    sendMessage: (text: string) => iris.runtime.sendMessageRef.current(text),
    sendCommand: (text: string) => iris.runtime.sendCommandRef.current(text),
    cancel: () => iris.runtime.cancelRef.current(),
    isRunning: iris.runtime.isBusyRef.current,
  };
}
