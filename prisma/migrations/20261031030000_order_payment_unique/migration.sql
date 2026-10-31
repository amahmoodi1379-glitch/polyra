-- A gateway's payment is applied once, however often its return address is opened (PRD §12.4 step 5).
CREATE UNIQUE INDEX "order_gateway_authority_key" ON "order"("gateway", "authority");

CREATE UNIQUE INDEX "order_gateway_gateway_ref_key" ON "order"("gateway", "gateway_ref");
