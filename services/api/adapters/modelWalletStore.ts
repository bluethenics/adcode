import type { SupabaseClient } from "@supabase/supabase-js";
import type { WalletStore, WalletView } from "../src/modelWallet.ts";

const check = (error: { message: string } | null): void => { if (error) throw new Error(`Model wallet storage: ${error.message}`); };
export function createModelWalletStore(lazy: () => Promise<SupabaseClient>): WalletStore {
  return {
    async getModelWallet(uid, now) {
      const { data, error } = await (await lazy()).rpc("model_wallet_view", { p_uid: uid, p_now: now }); check(error);
      return data as WalletView;
    },
    async createWalletOrder(order) {
      const { data, error } = await (await lazy()).rpc("create_model_wallet_order", { p_order: order.orderId, p_uid: order.uid, p_cents: order.priceCents, p_now: order.createdAt }); check(error); return data === true;
    },
    async completeWalletOrder(orderId, sessionId) {
      const { error } = await (await lazy()).from("model_wallet_orders").update({ checkout_session: sessionId }).eq("order_id", orderId).eq("status", "pending"); check(error);
    },
    async applyWalletEvent(event) {
      const { data, error } = await (await lazy()).rpc("apply_model_wallet_event", { p_type: event.type, p_webhook: event.webhookId, p_order: event.orderId ?? "", p_payment: event.paymentId, p_session: event.sessionId, p_amount: event.amountMicros.toString(), p_tax: (event.taxMicros ?? 0n).toString(), p_now: event.now }); check(error);
      if (!["credited", "refunded", "duplicate", "review", "not-ai-tokens"].includes(data)) throw new Error("Invalid model wallet event result");
      return data;
    },
    async reserveModelWallet(id, uid, model, micros, now) {
      const { data, error } = await (await lazy()).rpc("reserve_model_wallet", { p_id: id, p_uid: uid, p_model: model, p_micros: micros, p_now: now }); check(error); return data === true;
    },
    async settleModelWallet(id, micros, estimated, now) {
      const { error } = await (await lazy()).rpc("settle_model_wallet", { p_id: id, p_micros: micros, p_estimated: estimated, p_now: now }); check(error);
    },
  };
}
