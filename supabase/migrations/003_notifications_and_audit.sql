-- ==========================================
-- NOTIFICATIONS TABLE
-- ==========================================

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    reference_type VARCHAR(20), -- 'FF3', 'FF4', 'BUDGET', etc.
    reference_id UUID,
    is_read BOOLEAN DEFAULT FALSE,
    is_email_sent BOOLEAN DEFAULT FALSE,
    priority VARCHAR(20) DEFAULT 'MEDIUM', -- 'LOW', 'MEDIUM', 'HIGH', 'URGENT'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    read_at TIMESTAMP WITH TIME ZONE
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- ==========================================
-- AUDIT LOG TABLE
-- ==========================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_email VARCHAR(255),
    user_name VARCHAR(255),
    action VARCHAR(100) NOT NULL, -- 'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', etc.
    entity_type VARCHAR(50) NOT NULL, -- 'FF3', 'FF4', 'USER', 'BUDGET', etc.
    entity_id UUID,
    entity_reference VARCHAR(100), -- e.g., FF3 number, FF4 number
    old_values JSONB,
    new_values JSONB,
    changes JSONB, -- Summary of what changed
    ip_address VARCHAR(50),
    user_agent TEXT,
    session_id VARCHAR(100),
    metadata JSONB, -- Any additional context
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for audit log queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id ON audit_logs(entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_reference ON audit_logs(entity_reference);

-- ==========================================
-- RLS POLICIES FOR NOTIFICATIONS
-- ==========================================

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can view their own notifications
CREATE POLICY "Users can view own notifications"
    ON notifications FOR SELECT
    USING (user_id = auth.uid() OR user_id IS NULL);

-- Users can update their own notifications (mark as read)
CREATE POLICY "Users can update own notifications"
    ON notifications FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- System can insert notifications
CREATE POLICY "System can insert notifications"
    ON notifications FOR INSERT
    WITH CHECK (true);

-- ==========================================
-- RLS POLICIES FOR AUDIT LOGS
-- ==========================================

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view audit logs (for now, allow all authenticated users)
CREATE POLICY "Authenticated users can view audit logs"
    ON audit_logs FOR SELECT
    USING (auth.role() = 'authenticated');

-- System can insert audit logs
CREATE POLICY "System can insert audit logs"
    ON audit_logs FOR INSERT
    WITH CHECK (true);

-- ==========================================
-- FUNCTION TO LOG AUDIT EVENTS
-- ==========================================

CREATE OR REPLACE FUNCTION log_audit_event(
    p_user_id UUID,
    p_user_email VARCHAR(255),
    p_user_name VARCHAR(255),
    p_action VARCHAR(100),
    p_entity_type VARCHAR(50),
    p_entity_id UUID,
    p_entity_reference VARCHAR(100),
    p_old_values JSONB DEFAULT NULL,
    p_new_values JSONB DEFAULT NULL,
    p_changes JSONB DEFAULT NULL,
    p_metadata JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_audit_id UUID;
BEGIN
    INSERT INTO audit_logs (
        user_id, user_email, user_name, action, entity_type,
        entity_id, entity_reference, old_values, new_values, changes, metadata
    ) VALUES (
        p_user_id, p_user_email, p_user_name, p_action, p_entity_type,
        p_entity_id, p_entity_reference, p_old_values, p_new_values, p_changes, p_metadata
    ) RETURNING id INTO v_audit_id;

    RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- TRIGGER FOR FF3 AUDIT LOGGING
-- ==========================================

CREATE OR REPLACE FUNCTION audit_ff3_changes() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM log_audit_event(
            NULL, NULL, 'System',
            'CREATE',
            'FF3',
            NEW.id,
            NEW.ff3_number,
            NULL,
            to_jsonb(NEW),
            jsonb_build_object('status', NEW.status),
            NULL
        );
    ELSIF TG_OP = 'UPDATE' THEN
        -- Only log if status changed or significant fields changed
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            PERFORM log_audit_event(
                NULL, NULL, 'System',
                CASE
                    WHEN NEW.status = 'APPROVED' THEN 'APPROVE'
                    WHEN NEW.status = 'REJECTED' THEN 'REJECT'
                    WHEN NEW.status = 'SUBMITTED' THEN 'SUBMIT'
                    ELSE 'UPDATE'
                END,
                'FF3',
                NEW.id,
                NEW.ff3_number,
                jsonb_build_object('status', OLD.status),
                jsonb_build_object('status', NEW.status),
                jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status),
                NULL
            );
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER ff3_audit_trigger
    AFTER INSERT OR UPDATE ON ff3_headers
    FOR EACH ROW EXECUTE FUNCTION audit_ff3_changes();

-- ==========================================
-- TRIGGER FOR FF4 AUDIT LOGGING
-- ==========================================

CREATE OR REPLACE FUNCTION audit_ff4_changes() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM log_audit_event(
            NULL, NULL, 'System',
            'CREATE',
            'FF4',
            NEW.id,
            NEW.ff4_number,
            NULL,
            to_jsonb(NEW),
            jsonb_build_object('status', NEW.status),
            NULL
        );
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            PERFORM log_audit_event(
                NULL, NULL, 'System',
                CASE
                    WHEN NEW.status = 'PAID' THEN 'PAYMENT'
                    WHEN NEW.status = 'APPROVED' THEN 'APPROVE'
                    WHEN NEW.status = 'CANCELLED' THEN 'CANCEL'
                    ELSE 'UPDATE'
                END,
                'FF4',
                NEW.id,
                NEW.ff4_number,
                jsonb_build_object('status', OLD.status),
                jsonb_build_object('status', NEW.status),
                jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status),
                NULL
            );
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER ff4_audit_trigger
    AFTER INSERT OR UPDATE ON ff4_headers
    FOR EACH ROW EXECUTE FUNCTION audit_ff4_changes();

-- ==========================================
-- REALTIME SUBSCRIPTIONS
-- ==========================================

-- Enable realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
