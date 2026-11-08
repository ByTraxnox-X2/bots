    conn.close()

    return render_template(
        "dashboard.html",
        devices=live_devices,
        jobs=jobs,
        stats=stats
    )


@app.route("/devices")
@login_required
def devices():

    live = adb_devices()

    devices = []

    for d in live:

        devices.append({
            "name": "Android",
            "serial": d["serial"],
            "status": (
                "online"
                if d["status"] == "device"
                else d["status"]
            )
        })

    return render_template(
        "devices.html",
        devices=devices
    )


@app.route("/regions")
@login_required
def regions():

    return render_template(
        "regions.html",
        regions=REGIONS
    )


@app.route("/jobs", methods=["GET", "POST"])
@login_required
def jobs():

    if request.method == "POST":

        target_id = request.form.get(
            "target_id",
            ""
        ).strip()

        region = request.form.get(
            "region",
            "EU"
        )

        try:
            amount = int(
                request.form.get(
                    "amount",
                    "2"
                )
            )

        except ValueError:

            amount = 2

        if (
            not target_id
            or region not in REGIONS
            or amount not in (2, 4)
        ):

            return render_template(
                "jobs.html",
                regions=REGIONS,
                error="Datos inválidos."
            )

        conn = db()

        cur = conn.execute(
            """
            INSERT INTO jobs
            (target_id, region, amount, created_by, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                target_id,
                region,
                amount,
                session["user_id"],
                now()
            )
        )

        conn.commit()

        job_id = cur.lastrowid

        conn.close()

        log(
            "job_created",
            f"job={job_id} target={target_id} region={region} amount={amount}"
        )

        return redirect(
            url_for("jobs")
        )

    conn = db()

    rows = conn.execute(
        """
        SELECT *
        FROM jobs
        ORDER BY id DESC
        """
    ).fetchall()

    conn.close()

    return render_template(
        "jobs.html",
        jobs=rows,
        regions=REGIONS
    )


@app.route("/history")
@login_required
def history():

    conn = db()

    rows = conn.execute(
        """
        SELECT *
        FROM history
        ORDER BY id DESC
        LIMIT 200
        """
    ).fetchall()

    conn.close()

    return render_template(
        "history.html",
        history=rows
    )


@app.get("/api/health")
def api_health():

    return jsonify({
        "ok": True,
        "service": "ff-panel-pro"
    })


@app.get("/api/devices")
@login_required
def api_devices():

    return jsonify({
        "count": len(adb_devices()),
        "devices": adb_devices()
    })


@app.post("/api/jobs")
@login_required
def api_create_job():

    data = request.get_json(
        silent=True
    ) or {}

    target_id = str(
        data.get("target_id", "")
    ).strip()

    region = data.get(
        "region",
        "EU"
    )

    amount = data.get(
        "amount",
        2
    )

    try:
        amount = int(amount)
    except Exception:

        return jsonify({
            "error": "amount inválido"
        }), 400

    if not target_id:

        return jsonify({
            "error": "target_id requerido"
        }), 400

    if region not in REGIONS:

        return jsonify({
            "error": "región inválida"
        }), 400

    if amount not in (2, 4):

        return jsonify({
            "error": "amount debe ser 2 o 4"
        }), 400

    conn = db()

    cur = conn.execute(
        """
        INSERT INTO jobs
        (target_id, region, amount, created_by, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            target_id,
            region,
            amount,
            session["user_id"],
            now()
        )
    )

    conn.commit()

    job_id = cur.lastrowid

    conn.close()

    log(
        "api_job_created",
        f"job={job_id}"
    )

    return jsonify({
        "ok": True,
        "job_id": job_id,
        "region": region,
        "amount": amount,
        "status": "queued"
    }), 201


if __name__ == "__main__":

    init_db()

    app.run(
        host="0.0.0.0",
        port=5001,
        debug=True
    )
PY

python -m py_compile app.py
cd ~ && git clone https://github.com/arjun551/ffguildbot.git
cd ~/ffguildbot && ls
pip install -r requirements.txt
pkg install opencv
python --version
cd ~/ffguildbot
# Detener cualquier instalación anterior
pkill -f "pip install" 2>/dev/null || true
# Actualizar pip
python -m pip install --upgrade pip
# Instalar dependencias que sí funcionan directamente
python -m pip install flask pure-python-adb
# Comprobar el proyecto
python -m py_compile app.py bot.py createbot.py config.py
# Verificar ADB
adb devices
cd ~/ffguildbot && python app.py
cd ~/ffbwbots
bash instalar-termux.sh
cd
rm -rf ~/ffbwbots
termux-setup-storage
cd ~/storage/downloads
unzip -o FF_ULTRA_Termux.zip
mv ffbwbots ~/ffbwbots
cd ~/ffbwbots
bash instalar-termux.sh
node index.js
cd
rm -rf ~/ffbwbots
cd ~/storage/downloads
unzip -o FF_ULTRA_Termux_v2.zip
mv ffbwbots ~/ffbwbots
cd ~/ffbwbots
bash verificar-termux.sh
bash instalar-termux.sh
node index.js
cd
rm -rf ~/ffbwbots
cd ~/storage/downloads
unzip -o FF_ULTRA_Termux_v2_1.zip
mv ffbwbots ~/ffbwbots
cd ~/ffbwbots
bash verificar-termux.sh
bash instalar-termux.sh
node index.js
cd
rm -rf ~/ffbwbots
cd ~/storage/downloads
unzip -o FF_ULTRA_Termux_v2_2.zip
mv ffbwbots ~/ffbwbots
cd ~/ffbwbots
bash instalar-termux.sh
node index.js
cd
cd ~/storage/downloads
unzip -o BW_BOT_v3.0_Termux.zip
rm -rf ~/ffbwbots
mv ffbwbots ~/ffbwbots
cd ~/ffbwbots
bash verificar-termux.sh
bash instalar-termux.sh
cd ~
rm -rf ~/BW-STORE-BOT
ls
unzip ~/storage/downloads/BW-STORE-BOT.zip -d ~/BW-STORE-BOT
cd ~/BW-STORE-BOT
ls
git add .
git commit -m "Actualización BW STORE BOT"
git push
git init
git branch -M main
git remote add origin https://github.com/ByTraxnox-X2/bw-store-bots.git
git add .
git commit -m "Actualización BW STORE BOT"
git push -u origin main
git push -u origin main --force
npm view @whiskeysockets/baileys version
npm view @whiskeysockets/baileys@6 version
npm ls @whiskeysockets/baileys
y
curl -s -u "BAAGgkTvLEBQe6SzbOBvT-ed2KvLi3i2OJVQisl1mQ5i7nf3tfVq2XmG-1PCUt82jdNEaa4c8E0vE5l_Q4:EDkynktycHMYxJ93pT7_VzJbFEfSh9pNg9ySTZrrc_TPDEcbNfrKfH0-zJfIIIZqkXKMOdV065sLjFKV" -d "grant_type=client_credentials" https://api-m.paypal.com/v1/oauth2/token
pkg install git unzip
cd ~/storage/downloads
unzip EliminarDuplicadosPremium_v2.zip
cd EliminarDuplicadosPremium
pkg install git unzip
termux-setup-storage
cd ~/storage/downloads
unzip EliminarDuplicadosPremium_v2.zip
cd EliminarDuplicadosPremium
y
git init
git add -A
git commit -m "Proyecto"
git branch -M main
git remote add origin https://github.com/ByTraxnox-X2/apks-limpiador.git
git push -u origin main
cd ~
rm -rf .git
rm -f README.md
rm -rf ~/storage/downloads/EliminarDuplicadosPremium
cd ~/storage/downloads
\rm -rf EliminarDuplicadosPremium
unzip -oq EliminarDuplicadosPremium_v2.zip
cd EliminarDuplicadosPremium
\rm -rf .git
git init
git add -A
git commit -qm "Proyecto"
git branch -M main
git remote remove origin 2>/dev/null
git remote add origin https://github.com/ByTraxnox-X2/apks-limpiador.git
git push -u origin main --force
git config --global --add safe.directory '*'
git config --global user.name "ByTraxnox-X2"
git config --global user.email "servenuevo@gmail.com"
git add -A
git commit -qm "Proyecto"
git branch -M main
git remote remove origin 2>/dev/null
git remote add origin https://github.com/ByTraxnox-X2/apks-limpiador.git
git push -u origin main --force
cd ~/storage/downloads/EliminarDuplicadosPremium
sed -i 's|^      - uses: android-actions/setup-android@v3$|      - name: Aceptar licencias del SDK de Android\n        run: yes \| "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses > /dev/null \|\| true|' .github/workflows/build-apk.yml
git add -A
git commit -qm "Arreglar preparacion del SDK"
git push origin main
cd ~/storage/downloads/EliminarDuplicadosPremium
git update-index --chmod=+x gradlew
git commit -qm "Dar permiso de ejecucion a gradlew"
git push origin main
cd ~/storage/downloads/EliminarDuplicadosPremium
cat > .github/workflows/build-apk.yml <<'EOF'
name: Compilar APK y AAB

on:
  push:
    branches: [main, master]
  pull_request:
  workflow_dispatch:

jobs:
  android:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17
      - name: Aceptar licencias del SDK de Android
        run: yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses > /dev/null || true
      - uses: gradle/actions/setup-gradle@v4

      - name: Pruebas del motor de duplicados
        run: ./gradlew :core:test --stacktrace

      - name: Compilar APK de depuracion (app y administracion)
        run: |
          set -o pipefail
          ./gradlew :app:assemblePlayDebug :admin:assembleDebug --continue --stacktrace 2>&1 | tee build.log
        env:
          ORG_GRADLE_PROJECT_licenseServerUrl: ${{ vars.LICENSE_SERVER_URL }}
          ORG_GRADLE_PROJECT_licensePublicKey: ${{ vars.LICENSE_PUBLIC_KEY }}
          ORG_GRADLE_PROJECT_privacyPolicyUrl: ${{ vars.PRIVACY_POLICY_URL }}
          ORG_GRADLE_PROJECT_supportEmail: ${{ vars.SUPPORT_EMAIL }}
          ORG_GRADLE_PROJECT_adminServerUrl: ${{ vars.ADMIN_SERVER_URL }}

      - name: Resumen de errores
        if: always()
        run: |
          {
            echo '## Errores de compilacion'
            echo '```'
            grep -E '^e: |What went wrong|Execution failed|^> ' build.log | sed 's#file:///home/runner/work/[^/]*/[^/]*/##' | head -70
            echo '```'
          } >> "$GITHUB_STEP_SUMMARY"

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: apk-depuracion
          path: |
            app/build/outputs/apk/play/debug/*.apk
            admin/build/outputs/apk/debug/*.apk
            build.log
EOF

git add -A
git commit -qm "Mostrar errores de compilacion en un resumen"
git push origin main
cd ~/storage/downloads/EliminarDuplicadosPremium
F=app/src/main/java/app/duplicados/premium/DuplicatesApp.kt
sed -i 's/app\.duplicados\.premium\.core\.license\.Feature\.SCHEDULED_SCANS/Feature.SCHEDULED_SCANS/; s/app\.duplicados\.premium\.core\.license\.Entitlements\.isAllowed/Entitlements.isAllowed/g; s/feature: app\.duplicados\.premium\.core\.license\.Feature)/feature: Feature)/; s/app\.duplicados\.premium\.scan\.ScanScheduler\.apply/ScanScheduler.apply/; s/app\.duplicados\.premium\.remote\.FcmTokenFetcher\.fetch/FcmTokenFetcher.fetch/' $F
sed -i 's/^import app\.duplicados\.premium\.scan\.ScanManager$/import app.duplicados.premium.scan.ScanManager\nimport app.duplicados.premium.scan.ScanScheduler\nimport app.duplicados.premium.remote.FcmTokenFetcher\nimport app.duplicados.premium.core.license.Feature\nimport app.duplicados.premium.core.license.Entitlements/' $F
sed -i 's/^import androidx\.compose\.foundation\.layout\.fillMaxSize$/import androidx.compose.foundation.layout.fillMaxSize\nimport androidx.compose.ui.Modifier/' admin/src/main/java/app/duplicados/premium/admin/MainActivity.kt
git add -A
git commit -qm "Corregir errores de compilacion"
git push origin main
scp ~/storage/downloads/BW-ANDROID-CLOUD.zip root@31.220.99.68:/root/
ssh -o ServerAliveInterval=30 root@31.220.99.68
cd /sdcard/Download
ls -lah
unzip -o guildglory-bot-fixed.zip -d guildglory-bot-fixed
cd /sdcard/Download/guildglory-bot-fixed
ls -la
cd /sdcard/Download/guildglory-bot-fixed
la
ls
cd
cd /sdcard/Download/guildglory-bot-fixed
git init
git branch -M main
git add .
git status
git commit -m "Initial upload - BW Glory"
git remote add origin https://github.com/ByTraxnox-X2/bw-glory.git
git push -u origin main
cd
clear
scp ~/storage/downloads/BW-ANDROID-CLOUD.zip root@31.220.99.68:/root/
ssh -o ServerAliveInterval=30 root@31.220.99.68
