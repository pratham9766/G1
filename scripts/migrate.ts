import { store } from "../server/store";
store
  .init()
  .then(() => {
    console.log(
      "Additive workflow migration 002 applied; existing encrypted entities preserved.",
    );
    return store.close();
  })
  .catch(() => {
    console.error(
      "Migration failed; inspect database connectivity and schema permissions.",
    );
    process.exitCode = 1;
  });
