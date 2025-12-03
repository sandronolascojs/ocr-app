import { serve } from "inngest/next";
import { inngest } from "../../../inngest/client";
import { processOcrJob } from "@/inngest/functions/processOcrJob";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processOcrJob
  ],
});