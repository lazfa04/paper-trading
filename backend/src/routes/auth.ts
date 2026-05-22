import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db";
import { authenticate } from "../middleware/auth";

const router = Router();
const SALT_ROUNDS = 10;

interface UserRow {
  id: number;
  email: string;
  username: string;
  password_hash: string;
  created_at: Date;
}

function signToken(user: { id: number; email: string }): string {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not set");
  }
  return jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function toPublicUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    created_at: row.created_at,
  };
}

router.post("/register", async (req: Request, res: Response) => {
  const { email, username, password } = req.body;

  if (!email || !username || !password) {
    res.status(400).json({ message: "email, username, and password are required" });
    return;
  }

  try {
    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1 OR username = $2",
      [email, username]
    );

    if (existing.rows.length > 0) {
      res.status(409).json({ message: "Email or username already taken" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const userResult = await client.query<UserRow>(
        `INSERT INTO users (email, username, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, email, username, password_hash, created_at`,
        [email, username, passwordHash]
      );

      const user = userResult.rows[0];

      await client.query(
        `INSERT INTO portfolios (user_id, cash_balance)
         VALUES ($1, 10000.00)`,
        [user.id]
      );

      await client.query("COMMIT");

      const token = signToken(user);
      res.status(201).json({ token, user: toPublicUser(user) });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ message: "email and password are required" });
    return;
  }

  try {
    const result = await pool.query<UserRow>(
      "SELECT id, email, username, password_hash, created_at FROM users WHERE email = $1",
      [email]
    );

    const user = result.rows[0];

    if (!user) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    const token = signToken(user);
    res.json({ token, user: toPublicUser(user) });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/me", authenticate, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.username, u.created_at, p.cash_balance
       FROM users u
       LEFT JOIN portfolios p ON p.user_id = u.id
       WHERE u.id = $1
       ORDER BY p.id ASC
       LIMIT 1`,
      [req.user!.id]
    );

    const row = result.rows[0];

    if (!row) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.json({
      id: row.id,
      email: row.email,
      username: row.username,
      created_at: row.created_at,
      cash_balance: row.cash_balance ?? null,
    });
  } catch (err) {
    console.error("Me error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
