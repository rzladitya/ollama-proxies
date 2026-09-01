import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "./db.js";
import { accountPools, settings } from "./schema.js";
import { DEFAULT_ROUTING_CONFIG } from "@ollama-proxy/shared";

export async function bootstrapDefaults(db: AppDatabase): Promise<void> {
  const now = new Date().toISOString();

  // Create default "all" pool if not exists
  const existingPool = await db.query.accountPools.findFirst({
    where: eq(accountPools.name, "all"),
  });

  if (!existingPool) {
    await db.insert(accountPools).values({
      id: "all",
      name: "all",
      description: "Default pool containing all accounts",
      createdAt: now,
      updatedAt: now,
    });
  }

  // Insert default routing settings if not exists
  const routingKey = "routing_config";
  const existingRouting = await db.query.settings.findFirst({
    where: eq(settings.key, routingKey),
  });

  if (!existingRouting) {
    await db.insert(settings).values({
      key: routingKey,
      value: JSON.stringify(DEFAULT_ROUTING_CONFIG),
      updatedAt: now,
    });
  }
}
