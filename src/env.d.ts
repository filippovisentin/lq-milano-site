declare namespace App {
  interface Locals {
    admin: { user: string; role: import('./lib/users').Role } | null;
  }
}
