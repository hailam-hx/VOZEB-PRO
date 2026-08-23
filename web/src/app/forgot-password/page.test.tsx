import { App } from "antd";
import { describe, expect, it } from "vitest";

import ForgotPasswordPage from "./page";
import { renderWithI18n } from "@/test/render-with-i18n";

describe("ForgotPasswordPage translations", () => {
    it.each([
        ["vi", "Đặt lại mật khẩu", "Email đã liên kết"],
        ["en", "Reset password", "Linked email"],
        ["zh-CN", "重置密码", "绑定邮箱"],
    ] as const)("renders in %s", (locale, title, email) => {
        const html = renderWithI18n(
            <App>
                <ForgotPasswordPage />
            </App>,
            locale,
        );

        expect(html).toContain(title);
        expect(html).toContain(email);
    });
});
