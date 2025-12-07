import { env } from "@/env.mjs";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  emailOTP,
  haveIBeenPwned,
  HaveIBeenPwnedOptions,
} from "better-auth/plugins";
import { Resend } from "resend";

const haveIBeenPwnedPlugin: HaveIBeenPwnedOptions = {
  customPasswordCompromisedMessage:
    "This password has been compromised in a data breach. Please choose a different password.",
};

const cacheTTL = 5 * 60 * 1000; // 5 minutes
const TTL = 60 * 60 * 1000; // 1 hour

const trustedOrigins =
  env.ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];

export const auth: ReturnType<typeof betterAuth> = betterAuth({
  session: {
    cookieCache: {
      enabled: true,
      maxAge: cacheTTL,
    },
  },
  secret: env.BETTER_AUTH_SECRET,
  rateLimit: {
    enabled: true,
    max: 100,
    window: TTL,
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      ...schema,
    },
    usePlural: true,
  }),
  trustedOrigins: trustedOrigins,
  emailAndPassword: {
    enabled: true,
    resetPasswordUrl: `${env.BETTER_AUTH_URL}/reset-password/confirm`,
    resetPasswordRedirect: "/login",
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url, token }) => {
      if (env.RESEND_API_KEY) {
        const resend = new Resend(env.RESEND_API_KEY);
        if (!env.EMAIL_FROM) {
          throw new Error("EMAIL_FROM is not set");
        }
        await resend.emails.send({
          from: env.EMAIL_FROM,
          to: user.email,
          subject: "Reset your password",
          html: `<p>Click the link to reset your password:</p><p><a href="${url}/reset-password/confirm?token=${token}">${url}/reset-password/confirm</a></p><p>If you did not request a password reset, please ignore this email.</p>`,
        });
      }
    },
  },
  socialProviders: {
    google: {
      enabled: true,
      prompt: "select_account",
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
  plugins: [
    haveIBeenPwned(haveIBeenPwnedPlugin),
      emailOTP({
        async sendVerificationOTP({ email, otp, type }) {
          if (env.RESEND_API_KEY) {
            const resend = new Resend(env.RESEND_API_KEY);
            const subjectMap: Record<string, string> = {
              "sign-in": "Your sign-in code",
              "email-verification": "Verify your email",
              "forget-password": "Reset your password",
            };
            if (!env.EMAIL_FROM) {
              throw new Error("EMAIL_FROM is not set");
            }

            const resetUrl = `${env.BETTER_AUTH_URL}/reset-password/confirm?email=${encodeURIComponent(email)}`;

            const emailContent =
              type === "forget-password"
                ? {
                    subject: subjectMap[type] ?? "Your code",
                    html: `
                      <p>You requested to reset your password.</p>
                      <p>Your reset code is: <strong>${otp}</strong></p>
                      <p>Or click the link below to enter the code:</p>
                      <p><a href="${resetUrl}">${resetUrl}</a></p>
                      <p>This code will expire in 10 minutes.</p>
                      <p>If you did not request a password reset, please ignore this email.</p>
                    `,
                    text: `You requested to reset your password. Your reset code is: ${otp}. Visit ${resetUrl} to reset your password. This code will expire in 10 minutes. If you did not request a password reset, please ignore this email.`,
                  }
                : {
                    subject: subjectMap[type] ?? "Your code",
                    text: `Your verification code is ${otp}`,
                  };

            await resend.emails.send({
              from: env.EMAIL_FROM,
              to: email,
              ...emailContent,
            });
          }
        },
      }),
  ],
});
