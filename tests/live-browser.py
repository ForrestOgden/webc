"""Public deployment smoke test using Chrome's simulated camera and microphone.

This verifies functional WebRTC on one CI host, not cross-NAT TURN reliability.
"""
import os
import time
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('ROAM_TEST_ORIGIN', 'https://roam-video-chat.onrender.com')


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            channel='chrome', headless=True,
            args=[
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
                '--autoplay-policy=no-user-gesture-required',
                '--disable-dev-shm-usage',
            ],
        )
        contexts = [browser.new_context(permissions=['camera', 'microphone']) for _ in range(2)]
        pages = [context.new_page() for context in contexts]
        errors = [[], []]
        try:
            for i, page in enumerate(pages):
                page.on('pageerror', lambda err, n=i: errors[n].append(str(err)))
                response = page.goto(BASE, wait_until='domcontentloaded', timeout=90_000)
                assert response and response.status == 200, f'Page {i} failed navigation'
                page.select_option('#your-region', 'oceania' if i == 0 else 'middle-east')
                page.select_option('#target-region', 'middle-east' if i == 0 else 'oceania')
                page.locator('#adult-confirm').check()
                page.locator('#start-button').click(timeout=20_000)
                expect(page.locator('#experience')).to_be_visible(timeout=20_000)
                print(f'Browser client {i+1}: camera/microphone permission granted, socket search started')

            for i, page in enumerate(pages):
                expect(page.locator('#session-status')).to_have_text('Connected · Live', timeout=55_000)
                page.wait_for_function('''() => {
                    const video = document.getElementById('remote-video');
                    const stream = video?.srcObject;
                    return stream && stream.getTracks().some(track => track.kind === 'video' && track.readyState === 'live')
                        && stream.getTracks().some(track => track.kind === 'audio' && track.readyState === 'live');
                }''', timeout=15_000)
                print(f'Browser client {i+1}: WebRTC connected, remote audio and video tracks received')

            message = 'Roam CI browser verification'
            pages[0].locator('#chat-input').fill(message)
            pages[0].locator('#send-button').click()
            expect(pages[1].locator('#chat-messages')).to_contain_text(message, timeout=10_000)
            print('Live text chat received by the other browser')

            pages[0].locator('#mic-button').click()
            assert pages[0].locator('#mic-button').get_attribute('aria-label') == 'Unmute microphone'
            pages[0].locator('#camera-button').click()
            assert pages[0].locator('#camera-button').get_attribute('aria-label') == 'Turn on camera'
            pages[0].locator('#end-button').click()
            expect(pages[0].locator('#landing')).to_be_visible(timeout=10_000)
            print('Microphone, camera, and hangup controls passed')
            assert not errors[0] and not errors[1], f'Uncaught page errors: {errors}'
        finally:
            for context in contexts:
                context.close()
            browser.close()


if __name__ == '__main__':
    main()
