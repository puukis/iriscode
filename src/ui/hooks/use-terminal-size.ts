import { useEffect, useState } from 'react';

export function useTerminalSize(): { columns: number; rows: number } {
  const [size, setSize] = useState(() => ({
    columns: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  }));

  useEffect(() => {
    const handleResize = () => {
      setSize({
        columns: process.stdout.columns ?? 80,
        rows: process.stdout.rows ?? 24,
      });
    };

    process.stdout.on('resize', handleResize);
    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, []);

  return size;
}
