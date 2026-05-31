Inline <b>raw HTML</b> and a dangerous payload:

<script>alert(1)</script>

<a href="javascript:alert(2)">click</a>

<img src="https://example.com/remote.png" onerror="alert(3)">
