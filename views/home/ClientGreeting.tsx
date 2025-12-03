'use client';

import { useTRPC } from '@/trpc/client';

interface ClientGreetingProps {
  text: string;
}

export const ClientGreeting = ({ text }: ClientGreetingProps) => {
  const trpc = useTRPC();
  const [data] = trpc.hello.useSuspenseQuery({ text });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
      <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Client greeting
      </span>
      <span className="text-2xl font-semibold">{data.greeting}</span>
    </div>
  );
};

