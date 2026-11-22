CREATE TABLE IF NOT EXISTS route_reports (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    type VARCHAR(40) NOT NULL,
    route_or_place VARCHAR(160) NOT NULL,
    description VARCHAR(1500) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pendiente',
    admin_note VARCHAR(500) NULL,
    reporter_username VARCHAR(60) NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
