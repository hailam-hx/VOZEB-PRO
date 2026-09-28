# DFLOP 视频免费验收与 Canary dry-run（2026-09-26T09:22:57.362Z）

本报告只运行本地合同、能力、计价与 request capture 检查；没有调用视频生成接口，没有创建 provider task。

## 当前结果

- 模型：68；全项免费检查通过：59；部分通过：0；受阻：9。
- 验收用例：81；实际重新检查通过：72；跳过：9。
- 合同指纹：68；dry-run 拟定 live case：72；跳过指纹：9。
- 全部拟定 case 的保守预算上界：7041.80736 DFLOP_CREDITS/task；17.6045184 HOTX credits。它们是预算估计，实际费用为 0。
- 六个旧 `REFERENCE_FIXTURE_UNAVAILABLE` first-frame case 已重新检查，均为 `passed`：happyhorse-1.0-i2v, happyhorse-1.1-i2v, happyhorse-1.1-t2v, tvod-hailuo-h3, wan2.7-t2v, wan3.0-video。
- HTTPS fixtures：两条按 Git commit 锁定的公开 WebP URL；独立 GET Range 返回 HTTP 206、`image/webp` 和正确 RIFF/WEBP signature。未通过 live generation 证明 DFLOP 从其部署地区可抓取。
- 当前 API Key 可见模型：211；public registry：220。本次两者无缺失 ID。之前记录的 `doubao-seedance-2.0-2` 当前不在 key-scoped `/v1/models`，也不在 public registry；同名 logical model 目前绑定的上游 ID 是 `doubao-seedance-2.0`，不能误报当前 binding 为 registry mismatch。

## Fingerprint → cheapest canary（只规划，不提交）

| contractFingerprint | modelsInGroup | selectedCanaryModel | cases | blockedReason |
|---|---|---|---|---|
| `819fa1e069ad0ce98b0f5fa7b377e782739337047142bd5dc88425cb678c9c0f` | doubao-seedance-2.5 | doubao-seedance-2.5 | text-to-video, image-to-video, first-frame, first-last-frame | — |
| `20c4b509dc1dce2fb5173ff6a1c719e81609d9bdefb0ca1fd344908d3ab88e83` | doubao-seedance-2.0-fast | doubao-seedance-2.0-fast | text-to-video | — |
| `57af2e363765fe64fe08a90d71f2031fde90cb779e35db19d84728992f846f3d` | doubao-seedance-2.0-fast-lite | doubao-seedance-2.0-fast-lite | text-to-video | — |
| `4f289e4d0725be7eaf4e688df0e35209980f0ef0a64dc03311ac96f5542ec4e8` | doubao-seedance-2.0-lite | doubao-seedance-2.0-lite | text-to-video | — |
| `739711c1e206243b31595e3e581fcfea2ddcb72e99687d2a66b8b73a5babce69` | doubao-seedance-2.0-mini | doubao-seedance-2.0-mini | text-to-video | — |
| `20103ec4cdd885273db1aa401bfad11d2c60d095cfa724b4d8de3ff484d55038` | doubao-seedance-2.0-mini-lite | doubao-seedance-2.0-mini-lite | text-to-video | — |
| `854e9d0e593529454b3c879c83115af33b2b1bdd430b4caf9294b07e0afbaab7` | doubao-seedance-2.5-lite | doubao-seedance-2.5-lite | text-to-video, image-to-video, first-frame, first-last-frame | — |
| `30e3bd1a30490389b0392f927b402aa495bd9ba28fc7394b211bc3d0d380c78a` | grok-imagine-video | — | text-to-video | COST_NOT_ESTIMATABLE |
| `c8d105b6f6d0ca32c2ef34b752b239c576175d7bb5984c288771fade86ba6561` | grok-imagine-video-1.5-preview | — | text-to-video | COST_NOT_ESTIMATABLE |
| `ee6f2359a3bdb207ee305494cc844bcb0e2870a316c09d1c77e73dfee50cb7f6` | happyhorse-1.0-i2v | happyhorse-1.0-i2v | text-to-video, first-frame | — |
| `50b3a39727047bfacb30186bf442c5bdf8ef441a28498d198137699d88f14fc8` | happyhorse-1.0-r2v | happyhorse-1.0-r2v | text-to-video | — |
| `77dafa6bfb953dcd621679f650342a3da716910ebab9fcb447e6ba24f4e79a27` | happyhorse-1.0-t2v | happyhorse-1.0-t2v | text-to-video, first-frame | — |
| `77cfe3b2e201d03516493cc399074420704c1075d3ade34447be8a8c72eacb3c` | happyhorse-1.0-video-edit | happyhorse-1.0-video-edit | text-to-video | — |
| `1994ad305241acd83b1f00f3f3e12c492d87ed4b2fcd855234d8441b27fa59a1` | happyhorse-1.1-i2v | happyhorse-1.1-i2v | text-to-video, first-frame | — |
| `404202505dee72bac639c9cb20b66f12e8ca72c65bb083f0722bd42d44ab6d7b` | happyhorse-1.1-r2v | happyhorse-1.1-r2v | text-to-video | — |
| `82ab28b813dc71f368e498fe6589f280268a4e9cd1790efa8e98e340c688ee5b` | happyhorse-1.1-t2v | happyhorse-1.1-t2v | text-to-video, first-frame | — |
| `4b87a85968d4112b1e61357a13e92120a09d449f1baff9435fc1062f85dd1586` | tvod-hailuo-02 | tvod-hailuo-02 | text-to-video | — |
| `4d77003cc7afe141a1d4dcece65140b0a2a89eb53a54b6e88c46041229544661` | tvod-hailuo-2.3 | tvod-hailuo-2.3 | text-to-video | — |
| `12b2838407430465f2137a9fa2822269433634cdefe37371ee792e68b2c5a516` | tvod-hailuo-2.3-fast | tvod-hailuo-2.3-fast | text-to-video | — |
| `5e0f1715037b1a032ef6e77832141c7d7f4229484cad5a7ba7e1037196cd3e9e` | tvod-hailuo-h3 | tvod-hailuo-h3 | text-to-video, first-frame | — |
| `9be1e5b4b9859c1fb851e685b8157c87a2c29a4734659abc07bcafc5f9bfc273` | tvod-hunyuan-video-1.0 | tvod-hunyuan-video-1.0 | text-to-video | — |
| `39ce0f5102f0de922cc5f4f449985673a9e8c01da5583b129e56432010b0bb8e` | tvod-hunyuan-video-1.1 | tvod-hunyuan-video-1.1 | text-to-video | — |
| `918dfb7671fcd086890594de5ac48cc928f206520ee1fc84609b1c0fee12f338` | tvod-jimeng-1.0-lite-i2v | tvod-jimeng-1.0-lite-i2v | text-to-video | — |
| `d1111fd50bb50c201d5fa2e4aede9d66994086278b3228af8490c4ddff74736c` | tvod-jimeng-1.0-pro | tvod-jimeng-1.0-pro | text-to-video | — |
| `d88c3993e3e3f14e97b8916592d887f95c29cdfcd4d0a2ff9a5f84203d7532b8` | tvod-jimeng-1.0-pro-fast | tvod-jimeng-1.0-pro-fast | text-to-video | — |
| `ba248940dedcc58dbd18dfa4f2cc90bf2834e1c3c527665556d72befc87cd36b` | tvod-jimeng-1.5-pro | tvod-jimeng-1.5-pro | text-to-video | — |
| `cf7673755a908732e93eb465f2298259d6118206af2efe6576bfa814896604a0` | tvod-jimeng-3.0 | tvod-jimeng-3.0 | text-to-video | — |
| `022ec77786a795ca2d9258bf1cc1854a6d47315a17c0374972ad263d2acb1252` | tvod-jimeng-3.0-pro | tvod-jimeng-3.0-pro | text-to-video | — |
| `09971665202a550d2e33b61a064d580597a65e23c55a715c0a481741ff54cde6` | tvod-jimeng-4.0 | tvod-jimeng-4.0 | text-to-video | — |
| `2b387694a96d367ee8c19330242302c1c9eda1e8f514b9c69b0a916f5de2eeaa` | tvod-kling-video-1.6 | tvod-kling-video-1.6 | text-to-video | — |
| `b4b809c6156871ec9b84fc7e4c2bf9103580afb95fc1197afb6b7fe5b8a39c03` | tvod-kling-video-2.0 | tvod-kling-video-2.0 | text-to-video | — |
| `ca62e780051e30f3ea527a569332311ff56770ff4eed721f0cc71db8fa3f7396` | tvod-kling-video-2.1 | tvod-kling-video-2.1 | text-to-video | — |
| `10147af63d26cbbd4e132a95de7a69c1780e5c706d269f75c354aa5bcdce4ae1` | tvod-kling-video-2.5-turbo | tvod-kling-video-2.5-turbo | text-to-video | — |
| `5c48458c3e5a701ae7a0fa1422e729d05e7ee0c1f64b654b67c11d82979c7f73` | tvod-kling-video-2.6 | tvod-kling-video-2.6 | text-to-video | — |
| `bd7b235d6e2499b44be6850f57b8a5fdebcacb6ed05187a6ded233ba0cf946a2` | tvod-kling-video-3.0 | tvod-kling-video-3.0 | text-to-video | — |
| `8bd4f34a4fd1d5857e77bb705c0cd8077f6b138ac73bfe40faa2ee9902f1c2d8` | tvod-kling-video-3.0-omni | tvod-kling-video-3.0-omni | text-to-video | — |
| `c0469d1b6983475ad05f723da4865f0cbf505c3e403ca2534f9ddb5fb5fbcd3c` | tvod-kling-video-master | tvod-kling-video-master | text-to-video | — |
| `9e78ace13a074a1db4de8235adfa03a3b92ddcbb0c56a93a801dca30844b5a9f` | tvod-kling-video-o1 | tvod-kling-video-o1 | text-to-video | — |
| `72dfcf985c0699155d742b4cbefbafa5b942505b2422838466f8d659fc112e21` | tvod-pixverse-c1 | tvod-pixverse-c1 | text-to-video | — |
| `c6089d04203bdc1f249bc865d18270e7c578f382df2f4b92fb1403992194ed46` | tvod-pixverse-v5.6 | tvod-pixverse-v5.6 | text-to-video | — |
| `9faa53deddce6bb23d13ea07cdb28b0f4f3fe6edd085dbf045a665dd14ca053b` | tvod-pixverse-v6 | tvod-pixverse-v6 | text-to-video | — |
| `e5a715b0a2a17d628d5025ca9afab1c9be5e4ec69c246f374669ac5e1845a468` | tvod-sora-2 | tvod-sora-2 | text-to-video | — |
| `5b7c4cd0937068f3f97b60cc576d65a34fb24b8e3838f97090b83109c89daf82` | tvod-veo-3.1 | tvod-veo-3.1 | text-to-video | — |
| `625947512fa8d450063afd72721d3621ffef4f35a37888158cc4bf5c38a5a75f` | tvod-veo-3.1-fast | tvod-veo-3.1-fast | text-to-video | — |
| `66406fece4d516c07f17bb97326faef1c4be13f0e3cde963a8e24574252c8932` | tvod-veo-3.1-lite | tvod-veo-3.1-lite | text-to-video | — |
| `394a40ea3c1f5d16e650e9de83392e6965a676198014cc2ef422d9d63b9fa896` | tvod-vidu-video-2.0 | tvod-vidu-video-2.0 | text-to-video | — |
| `22069fd887e20b09b107bc504ce4b69aeb21db42d7dc265144b32aefc9b55f64` | tvod-vidu-video-q1 | tvod-vidu-video-q1 | text-to-video | — |
| `acd5c03a18991ce599ba287d004b3efa88c81e0ff9b578dcf3a9fd4dfb243ee3` | tvod-vidu-video-q1-classic | tvod-vidu-video-q1-classic | text-to-video | — |
| `44f8a2a3b04b618e008d1d9611b2ffe3b3970cda04e9608978d4d44d9298384c` | tvod-vidu-video-q2 | tvod-vidu-video-q2 | text-to-video | — |
| `2f7871019a63cf477f9b2d0ab6abea8f0927bc233d1224b9fbcd7c1e576a7de9` | tvod-vidu-video-q2-pro | tvod-vidu-video-q2-pro | text-to-video | — |
| `c4de5c406d9697b6f09b02a10484bfba165521f4a2a360b1d63442aa5429835c` | tvod-vidu-video-q2-pro-fast | tvod-vidu-video-q2-pro-fast | text-to-video | — |
| `f36757d4bb17591e2036089793f62ae0a1dee9099dfc4a490895e281d458ff50` | tvod-vidu-video-q2-turbo | tvod-vidu-video-q2-turbo | text-to-video | — |
| `e7587f21cc0c20720660a5fb374a0ab9ac5869e67c35b8c8b8b11d13236025cb` | tvod-vidu-video-q3 | tvod-vidu-video-q3 | text-to-video | — |
| `367fa3e3f055e773ebac603cb9386b30f7536783989603d9230251ed6858e678` | tvod-vidu-video-q3-ad | tvod-vidu-video-q3-ad | text-to-video | — |
| `1da0ca74fd6723f50b380a783762b54599894aae1f5cb58752adeaa90a14d28b` | tvod-vidu-video-q3-drama | tvod-vidu-video-q3-drama | text-to-video | — |
| `5e14b4318b4078559407c90595964070c7b8d93521052b350b6dd2e39e3f1d85` | tvod-vidu-video-q3-pro | tvod-vidu-video-q3-pro | text-to-video | — |
| `8f58d57d2e2dcb1b2397cf946af7d6277950cb0dfa744f227fa943bf30737f97` | tvod-vidu-video-q3-turbo | tvod-vidu-video-q3-turbo | text-to-video | — |
| `096594f961602c8cd8fdf4e0cc3704357a16439cd43c100e4babc4ac43ba1306` | wan2.7-t2v | wan2.7-t2v | text-to-video, first-frame | — |
| `c715bfe967273059075f3f68708ca0d9561069c6d34a7cae2cab2c9ed976fe51` | wan3.0-video | wan3.0-video | text-to-video, first-frame | — |
| `66d8c2ba71c3ad5ee3a254a9e6e0abf4f10333c3712baad6eafe26b8ad25f5d9` | wan3.0-video-prime | wan3.0-video-prime | text-to-video | — |
| `2c6ae58906d5a756c63f30c0442b060a687e2a03c6b301043bef01cec2238648` | doubao-seedance-2.0-2 | doubao-seedance-2.0-2 | text-to-video | — |
| `8536ff4e4aa752bb01ba45a486743d2446566a0c6feba3a2d2b353ee80d91bab` | dh-avatar | — | text-to-video | COST_NOT_ESTIMATABLE |
| `b65bf46024317bccbabd8ee0d203c7b6ca22ff2ece599946995f9fbd5a41af65` | dh-lipsync | — | text-to-video | COST_NOT_ESTIMATABLE |
| `60431664d39ebadd1f38a38d4f045d8aab062e07bff8424b89c7d2a10f136fbf` | dh-lipsync-max | — | text-to-video | COST_NOT_ESTIMATABLE |
| `1a6b0a3bd247514510690ca14057166d8ba80593373f5c4ec2facf1f0aac47d4` | dh-lipsync-pro | — | text-to-video | COST_NOT_ESTIMATABLE |
| `af3230b3c73d87c837ef38fa92521b269035c8576dadcb3fbd90b6f97c2e6ca4` | dh-motion | — | text-to-video | COST_NOT_ESTIMATABLE |
| `39fd2f867be162da81e556aff7a42a867c8f3f30e2ec88a7485e31db4485efc6` | tvod-subtitle-soft | — | text-to-video | COST_NOT_ESTIMATABLE |
| `bb579cfc370756022a1a73020f227636e41f2a917a1425bef1fd286faa7e9a59` | clip-compose | — | text-to-video | PRICING_NEEDS_REVIEW |

## 尚未满足 live gate 的模型

| model | pricing status | endpoint_type | 公开价格字段 | unknownFields |
|---|---|---|---|---|
| grok-imagine-video | READY | videos_generations | price_per_video_second=6 | — |
| grok-imagine-video-1.5-preview | READY | videos_generations | price_per_video_second=6 | — |
| dh-avatar | READY | videos_generations | price_per_video_second=3.6 | — |
| dh-lipsync | READY | videos_generations | price_per_video_second=4.044 | — |
| dh-lipsync-max | READY | videos_generations | price_per_video_second=12.132 | — |
| dh-lipsync-pro | READY | videos_generations | price_per_video_second=8.088 | — |
| dh-motion | READY | videos_generations | price_per_video_second=8.088; video_price_tiers={"standard":"8.088","fast":"4.044","max":"12.132"} | — |
| tvod-subtitle-soft | READY | videos_generations | price_per_video_second=0.1011; video_price_tiers={"asr":"0.06066","translate":"0.04044"} | — |
| clip-compose | PARTIAL | videos_generations | price_per_video_task=48 | price_per_video_task |

Grok、dh-* 和字幕 SKU 的公开计费基准是视频秒数，但当前 binding 缺可执行的 duration/resolution 或专用输入合同，无法组成安全 normalized context。`clip-compose` 公开按任务计费，但需要先取得 `asr_id`；当前通用视频生成合同不能完成该工作流，因此维持 `PARTIAL`。Seedance Lite 的上游 token 档位已完整同步，旧 second-stage/unscoped dimension 在官方 token-only 价格合同完整时被退休；人工覆盖的旧维度仍保留 `STALE` 等待复核。

完整 normalized context、pricing snapshot、binding ID、provider ID、费用与阻塞原因见 [JSON 报告](./2026-09-26-video-validation-dry-run.json)。

官方依据：[DFLOP media API](https://model.dflop.top/docs/reference/media-apis)、[DFLOP model registry](https://model.dflop.top/docs/reference/models)。
