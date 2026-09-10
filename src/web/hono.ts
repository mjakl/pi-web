import type { Workspace } from "@core/workspace";
import type { Context, Env, Input } from "hono";
import { createFactory } from "hono/factory";

type AppEnvironment = {
  Variables: {
    workspace: Workspace;
  };
} & Env;

const honoFactory = createFactory<AppEnvironment>({
  defaultAppOptions: { strict: false },
});

type AppContext<P extends string = string, I extends Input = Input> = Context<
  AppEnvironment,
  P,
  I
>;

export type { AppContext, AppEnvironment };
export { honoFactory };
