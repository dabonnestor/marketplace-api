import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db, schema } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { config } from "../../shared/config.js";
import { AppError, ConflictError, UnauthorizedError } from "../../shared/errors.js";
import type { RegisterInput, LoginInput } from "./auth.schemas.js";
import type { JwtPayload } from "../../shared/middleware/auth.js";

function signAccess(user: { id: string; email: string }): string {
  return jwt.sign({ sub: user.id, email: user.email }, config.JWT_SECRET, {
    expiresIn: config.JWT_ACCESS_EXPIRES_IN as any,
  });
}

function signRefresh(user: { id: string; email: string }): string {
  return jwt.sign({ sub: user.id, email: user.email }, config.JWT_REFRESH_SECRET, {
    expiresIn: config.JWT_REFRESH_EXPIRES_IN as any,
  });
}

function toTokens(user: { id: string; email: string }) {
  return {
    accessToken: signAccess(user),
    refreshToken: signRefresh(user),
  };
}

export async function register(input: RegisterInput) {
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, input.email.toLowerCase().trim()))
    .limit(1);

  if (existing.length > 0) {
    throw new ConflictError("A user with this email already exists");
  }

  const passwordHash = await bcrypt.hash(input.password, 12);

  const [user] = await db
    .insert(schema.users)
    .values({
      email: input.email.toLowerCase().trim(),
      passwordHash,
      name: input.name.trim(),
    })
    .returning({ id: schema.users.id, email: schema.users.email, name: schema.users.name });

  return { user, ...toTokens(user) };
}

export async function login(input: LoginInput) {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, input.email.toLowerCase().trim()))
    .limit(1);

  if (!user) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const { passwordHash: _, ...safeUser } = user;
  return { user: safeUser, ...toTokens(user) };
}

export async function refresh(refreshToken: string) {
  try {
    const payload = jwt.verify(refreshToken, config.JWT_REFRESH_SECRET) as JwtPayload;

    const [user] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, payload.sub))
      .limit(1);

    if (!user) {
      throw new UnauthorizedError("User not found");
    }

    return toTokens(user);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new UnauthorizedError("Invalid or expired refresh token");
  }
}

export async function getMe(userId: string) {
  const [user] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user) {
    throw new UnauthorizedError("User not found");
  }

  return user;
}
