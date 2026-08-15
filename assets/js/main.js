/* ===========================================================================
   Qalam & Ahar — runtime enhancement
   No build step, and nothing here is load-bearing for reading the page: the
   words and the catalog are baked into index.html (by hand or by the visual
   builder in /static-admin/builder.html). This script only
     1. refreshes the data-driven lists and the announcement bar from
        /content/*.json, so a CMS edit shows up without re-saving the page,
     2. wires the sign-up form,
     3. adds the scroll-reveal motion.
   If a fetch fails — or JavaScript never runs — the baked-in page stands.
   Rendering logic lives in render.js (shared with the builder).
   =========================================================================== */

(function () {
  "use strict";

  // Opt in to JS-only styling (the scroll-reveal hide) only once this script
  // is actually running, so a blocked script can never strand content hidden.
  document.documentElement.classList.add("js");

  // Everything resolves against the directory the page is served from, so the
  // same files work at user.github.io/repo/ and at a custom domain root.
  var BASE = new URL(".", document.baseURI);

  /** Resolve a CMS media path (`/media/uploads/x.jpg`) against the site base. */
  function asset(path) {
    if (!path) return "";
    if (/^(https?:)?\/\//.test(path) || path.startsWith("data:")) return path;
    return new URL(String(path).replace(/^\/+/, ""), BASE).href;
  }

  var get = window.PureRender.get;
  var isFilled = window.PureRender.isFilled;

  function fetchJSON(name) {
    return fetch(new URL("content/" + name, BASE).href, { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error(name + ": HTTP " + res.status);
        return res.json();
      })
      .catch(function (err) {
        console.warn("[content]", err.message);
        return null;
      });
  }

  /* --- the notify form ---------------------------------------------------- */

  /**
   * Where a sign-up goes, in order of preference:
   *   1. the saastarter4-emdash backend, if this site has been told about one
   *   2. any third-party endpoint set in the CMS (Formspree and friends)
   *   3. the visitor's own mail app
   * This repo is public, so none of these can be a secret — the form id
   * identifies a form, it does not authorise anything.
   */
  /** A form's behaviour comes from its symbol's binding, stamped onto the
      markup at export: data-form (the backend form slug), data-endpoint (a
      third-party fallback), data-success (the message). Nothing global. */
  function submitEndpoint(content, form) {
    var backend = get(content, "site.backend") || {};
    var slug = form.dataset.form || backend.form;
    if (isFilled(backend.url) && isFilled(slug)) {
      return String(backend.url).replace(/\/+$/, "") + "/api/f/" + encodeURIComponent(slug);
    }
    return isFilled(form.dataset.endpoint) ? form.dataset.endpoint : "";
  }

  /* --- accounts -------------------------------------------------------------
     A second binding type, wired the same way the notify form is: the symbol
     says what it carries, the export stamps that onto the markup, and this
     reads the markup. Nothing global, and nothing here decides what an account
     may do — the node does, and it only ever hands a new one the default. */

  function apiRoot(content) {
    var backend = get(content, "site.backend") || {};
    return isFilled(backend.url)
      ? String(backend.url).replace(/\/+$/, "") + "/api"
      : "";
  }

  function post(url, body, method) {
    return fetch(url, {
      method: method || "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (parsed) {
          heldForDetails(parsed);
          return { ok: response.ok, body: parsed };
        });
    });
  }

  /* Which visitors a page is for, and where the others go. Read from the page
     itself, which the export stamped from the page's entry in the CMS. */
  function pageRule() {
    var read = function (name) {
      var node = document.querySelector('meta[name="' + name + '"]');
      return node ? node.getAttribute("content") : "";
    };
    return { needs: read("page-access"), to: read("page-redirect") };
  }

  /* Where to go once the sign-in lands.

     A page says where its visitors belong, but a caller may name somewhere
     else: the dashboard at /dynamic-admin sends people here in a popup and
     needs them back on the page that finishes the handshake, not on their
     account. Only a path on this site is honoured — an absolute URL in a query
     string is somebody else's redirect, and this is exactly the shape that gets
     used to bounce people off a trusted domain. */
  function nextTarget() {
    var raw = "";
    try {
      raw = new URLSearchParams(location.search).get("next") || "";
    } catch (error) {
      /* no URLSearchParams, or a malformed query — treated as unset */
    }
    return /^\/[^/\\]/.test(raw) ? raw : "";
  }

  /* --- passkeys -------------------------------------------------------------
     WebAuthn moves binary in and out of the browser, and the server speaks
     base64url, so the two conversions below are the whole adapter. Written out
     rather than pulled from a library: it is thirty lines, and a sign-in page
     is the last place to add a dependency loaded from someone else's CDN. */

  function fromB64(value) {
    var padded = String(value).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(raw, function (c) {
      return c.charCodeAt(0);
    });
  }

  function toB64(buffer) {
    var bytes = new Uint8Array(buffer);
    var out = "";
    for (var i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
    return btoa(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function credentialJson(credential) {
    var r = credential.response;
    var out = {
      id: credential.id,
      rawId: toB64(credential.rawId),
      type: credential.type,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: { clientDataJSON: toB64(r.clientDataJSON) },
    };
    if (r.attestationObject) {
      out.response.attestationObject = toB64(r.attestationObject);
      if (r.getTransports) out.response.transports = r.getTransports();
    } else {
      out.response.authenticatorData = toB64(r.authenticatorData);
      out.response.signature = toB64(r.signature);
      out.response.userHandle = r.userHandle ? toB64(r.userHandle) : undefined;
    }
    return out;
  }

  /* The node refuses everything an account with unfinished details asks for,
     and says so with one code. Wherever that arrives, the answer is the same
     page — the one with the questions on it — so it is handled once, here,
     rather than at each call site that might be the first to hit it.

     The account page itself is exempt, or landing there to answer the questions
     would bounce straight back to it. */
  function heldForDetails(body) {
    if (!body || body.code !== "profile_incomplete") return false;
    var here = location.pathname.replace(/\/+$/, "");
    if (/\/account$/.test(here) || /\/account\.html$/.test(here)) return false;
    location.assign("account");
    return true;
  }

  function getJson(url) {
    return fetch(url, { credentials: "include" }).then(function (response) {
      return response.json().then(function (body) {
        heldForDetails(body);
        return { ok: response.ok, body: body };
      });
    });
  }

  /* --- the account's own details -------------------------------------------
     A form bound to the account, drawn from the same definition the builder
     writes and the panel edits. Nothing here knows whose row it is: the server
     takes that from the session, so there is no id to send and none to forge. */

  function profileField(field, value) {
    var wrap = document.createElement("div");
    wrap.className = "account__field";

    var id = "profile-" + field.name;
    var label = document.createElement("label");
    label.setAttribute("for", id);
    label.textContent = field.label || field.name;
    if (field.required) label.textContent += " *";
    wrap.appendChild(label);

    var input;
    if (field.type === "textarea") {
      input = document.createElement("textarea");
      input.rows = 3;
    } else if (field.type === "select") {
      input = document.createElement("select");
      (field.options || []).forEach(function (choice) {
        var option = document.createElement("option");
        option.value = typeof choice === "string" ? choice : choice.value;
        option.textContent = typeof choice === "string" ? choice : choice.label;
        input.appendChild(option);
      });
    } else {
      input = document.createElement("input");
      input.type = field.type === "email" ? "email" : field.type === "tel" ? "tel" : "text";
    }

    input.id = id;
    input.name = field.name;
    input.className = "notify__input";
    if (field.placeholder) input.placeholder = field.placeholder;
    if (value !== undefined && value !== null) input.value = value;

    /* A field the node answers itself, shown so it can be checked rather than
       asked for. Disabled rather than readonly so nothing is posted under this
       name at all — the node substitutes it either way, and sending a value it
       intends to discard only invites the question of whether it does. */
    if (field.readOnly) {
      input.value = field.value || input.value;
      input.disabled = true;
      input.className += " notify__input--locked";
      wrap.className += " account__field--locked";
    }

    wrap.appendChild(input);
    return wrap;
  }

  function applyProfile(root) {
    var host = document.querySelector("[data-profile]");
    if (!host) return;

    getJson(root + "/api/me/profile")
      .then(function (result) {
        if (!result.ok) return;
        var forms = (result.body && result.body.forms) || [];
        host.replaceChildren();
        if (!forms.length) return;
        host.hidden = false;

        forms.forEach(function (form) {
          var section = document.createElement("form");
          section.className = "account__profile";
          section.setAttribute("novalidate", "");
          section.onsubmit = function () {
            return false;
          };

          var heading = document.createElement("p");
          heading.className = "account__title";
          heading.textContent = form.name;
          section.appendChild(heading);

          // Said plainly, and only when it is true: the page is asking for
          // something before it can get on.
          if (!form.complete && form.requiredAtSignup) {
            var ask = document.createElement("p");
            ask.className = "account__note";
            ask.textContent = "We need these before your first order.";
            section.appendChild(ask);
          }

          form.fields.forEach(function (field) {
            section.appendChild(profileField(field, form.values[field.name]));
          });

          var note = document.createElement("p");
          note.className = "account__status";
          note.hidden = true;

          var save = document.createElement("button");
          save.type = "submit";
          save.className = "btn btn--solid";
          save.textContent = "Save";
          section.appendChild(save);
          section.appendChild(note);

          section.addEventListener("submit", function (event) {
            event.preventDefault();
            var values = {};
            form.fields.forEach(function (field) {
              if (field.readOnly) return;
              var input = section.querySelector('[name="' + field.name + '"]');
              if (input) values[field.name] = input.value;
            });
            say(note, "Saving…");
            post(root + "/api/me/profile", { slug: form.slug, values: values }, "PUT")
              .then(function (res) {
                if (!res.ok) {
                  say(note, res.body.error || "That did not save.", true);
                  return;
                }
                say(note, "Saved.");
              })
              .catch(function () {
                say(note, "Could not reach the server.", true);
              });
          });

          host.appendChild(section);
        });
      })
      .catch(function () {
        /* signed out, or forms are off — the section simply stays empty */
      });
  }

  function applyAccounts(content) {
    var root = apiRoot(content);
    // The whole document, not one symbol: the masthead has a sign-out on some
    // sites and the forms live on their own pages now.
    var scope = document;
    if (!root) return;


    function say(node, message, isError) {
      if (!node) return;
      node.textContent = message || "";
      node.hidden = !message;
      if (isError) node.setAttribute("data-error", "");
      else node.removeAttribute("data-error");
    }

    /* One attribute on <html> says which half of the page is drawn, and CSS
       does the drawing. The inline script in the head has already set it from
       the stored hint, so by the time this runs the page is usually already
       right and nothing moves; when the hint was wrong — a session that
       expired since — this is what corrects it. */
    function paint(session) {
      var signedIn = Boolean(session && session.user);
      var name = signedIn ? session.user.name || session.user.email : "";

      if (signedIn) document.documentElement.dataset.account = "in";
      else delete document.documentElement.dataset.account;

      document.querySelectorAll("[data-account-name]").forEach(function (node) {
        node.textContent = name;
      });
      // The heading is not set here: both are in the markup and CSS shows the
      // one that matches. Writing it from script is what made it flip.

      // Remembered so the next visit paints straight into the right state. A
      // display hint, never a credential: the server is asked every time.
      try {
        if (signedIn) localStorage.setItem("qa.account", name);
        else localStorage.removeItem("qa.account");
      } catch (error) {
        /* storage refused; the page still works, it just flashes once */
      }

      // The head made the same call from the stored hint before painting; this
      // is the one that knows, and it catches a hint that had gone stale.
      var rule = pageRule();
      var wrong =
        (rule.needs === "signed-in" && !signedIn) ||
        (rule.needs === "signed-out" && signedIn);
      if (wrong && rule.to) location.replace(nextTarget() || rule.to);
    }

    // The greeting is already filled, during parse, by the inline script beside
    // it. Nothing to do here until the session check comes back.

    function refresh() {
      return fetch(root + "/auth/get-session", { credentials: "include" })
        .then(function (response) {
          return response.ok ? response.json() : null;
        })
        .catch(function () {
          return null;
        })
        .then(paint);
    }

    /* One flow for signing in and signing up, because with a code they are the
       same act: an address we know gets in, one we do not gets an account at
       the lowest role. The form asks for the address, then swaps to asking for
       the code — no password anywhere, so there is none to lose. */
    scope.querySelectorAll('form[data-account]').forEach(function (form) {
      var note = form.querySelector("[data-account-note]");
      var emailField = form.querySelector('[name="email"]');
      var codeStep = form.querySelector("[data-account-step=\'code\']");
      var askStep = form.querySelector("[data-account-step=\'email\']");
      var codeField = form.querySelector('[name="otp"]');

      function show(step) {
        if (askStep) askStep.hidden = step !== "email";
        if (codeStep) codeStep.hidden = step !== "code";
        var focus = step === "code" ? codeField : emailField;
        if (focus) focus.focus();
      }

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var email = (emailField && emailField.value.trim()) || "";
        var code = (codeField && codeField.value.trim()) || "";

        // Second leg: a code is present, so this is the verification.
        if (code) {
          say(note, "Checking your code…");
          post(root + "/auth/sign-in/email-otp", { email: email, otp: code })
            .then(function (result) {
              if (!result.ok) {
                say(note, "That code did not match. Ask for another if it has expired.", true);
                return;
              }
              say(note, "");
              refresh();
            })
            .catch(function () {
              say(note, "Could not reach the server.", true);
            });
          return;
        }

        // First leg: ask for a code.
        if (!email) {
          say(note, "Enter the address to send the code to.", true);
          return;
        }
        say(note, "Sending a code to " + email + "…");
        post(root + "/auth/email-otp/send-verification-otp", {
          email: email,
          type: "sign-in",
        })
          .then(function (result) {
            if (!result.ok) {
              say(note, result.body.message || "Could not send a code.", true);
              return;
            }
            show("code");
            say(note, "Six digits are on their way to " + email + ".");
          })
          .catch(function () {
            say(note, "Could not reach the server.", true);
          });
      });

      var again = form.querySelector("[data-account-restart]");
      if (again) {
        again.addEventListener("click", function () {
          if (codeField) codeField.value = "";
          show("email");
          say(note, "");
        });
      }
    });

    /* What is already registered. A page that offers to add a passkey and then
       never mentions it again leaves someone unsure whether it worked, and
       unable to take one away when they lose the device. */
    var list = scope.querySelector("[data-passkey-list]");

    function drawPasskeys() {
      if (!list) return Promise.resolve();
      return getJson(root + "/auth/passkey/list-user-passkeys")
        .then(function (result) {
          var keys = result.ok && Array.isArray(result.body) ? result.body : [];
          list.replaceChildren();
          list.hidden = false;

          if (!keys.length) {
            var none = document.createElement("p");
            none.className = "account__note";
            none.textContent = "No passkeys on this account yet.";
            list.appendChild(none);
            return;
          }

          keys.forEach(function (key) {
            var row = document.createElement("div");
            row.className = "passkey";

            var text = document.createElement("div");
            text.className = "passkey__text";
            var name = document.createElement("p");
            name.className = "passkey__name";
            name.textContent = key.name || "Unnamed device";
            var when = document.createElement("p");
            when.className = "passkey__when";
            when.textContent = key.createdAt
              ? "Added " + new Date(key.createdAt).toLocaleDateString()
              : "";
            text.appendChild(name);
            text.appendChild(when);

            var remove = document.createElement("button");
            remove.type = "button";
            remove.className = "btn btn--ghost passkey__remove";
            remove.textContent = "Remove";
            remove.addEventListener("click", function () {
              remove.disabled = true;
              post(root + "/auth/passkey/delete-passkey", { id: key.id })
                .then(function (res) {
                  if (!res.ok) {
                    remove.disabled = false;
                    say(addNote, "That one could not be removed.", true);
                    return;
                  }
                  // Only from here. The device keeps its own copy, which is
                  // now a key to a lock that no longer exists.
                  drawPasskeys();
                })
                .catch(function () {
                  remove.disabled = false;
                });
            });

            row.appendChild(text);
            row.appendChild(remove);
            list.appendChild(row);
          });
        })
        .catch(function () {
          /* signed out, or the account has none — the list simply stays empty */
        });
    }

    /* Registering one. Only offered to someone already signed in, because a
       passkey is a second way into an account that has to exist first. */
    var add = scope.querySelector("[data-passkey-add]");
    var addNote = scope.querySelector("[data-passkey-note]");
    if (add) {
      if (!window.PublicKeyCredential) {
        add.hidden = true;
      } else {
        add.addEventListener("click", function () {
          say(addNote, "Ask your device to make one…");
          getJson(root + "/auth/passkey/generate-register-options")
            .then(function (result) {
              if (!result.ok) throw new Error("options");
              var options = result.body;
              options.challenge = fromB64(options.challenge);
              options.user.id = fromB64(options.user.id);
              (options.excludeCredentials || []).forEach(function (entry) {
                entry.id = fromB64(entry.id);
              });
              return navigator.credentials.create({ publicKey: options });
            })
            .then(function (credential) {
              // The credential goes in `response`; a name beside it is what
              // the panel lists it as later.
              return post(root + "/auth/passkey/verify-registration", {
                response: credentialJson(credential),
                name: navigator.platform || "This device",
              });
            })
            .then(function (result) {
              say(
                addNote,
                result.ok
                  ? "Done. You can use this device to sign in from now on."
                  : "That did not save. Try again.",
                !result.ok,
              );
              if (result.ok) drawPasskeys();
            })
            .catch(function (error) {
              // A refusal is the visitor changing their mind, not a fault.
              say(
                addNote,
                error && error.name === "NotAllowedError"
                  ? ""
                  : "This device could not make a passkey.",
                true,
              );
            });
        });
      }
    }

    /* Using one. No address typed: the device knows which accounts it holds
       for this site, which is the entire appeal. */
    var use = scope.querySelector("[data-passkey-use]");
    if (use) {
      var useNote = scope.querySelector("[data-passkey-note]") ||
        scope.querySelector("[data-account-note]");
      if (!window.PublicKeyCredential) {
        use.hidden = true;
      } else {
        use.addEventListener("click", function () {
          say(useNote, "Ask your device…");
          getJson(root + "/auth/passkey/generate-authenticate-options")
            .then(function (result) {
              if (!result.ok) throw new Error("options");
              var options = result.body;
              options.challenge = fromB64(options.challenge);
              (options.allowCredentials || []).forEach(function (entry) {
                entry.id = fromB64(entry.id);
              });
              return navigator.credentials.get({ publicKey: options });
            })
            .then(function (credential) {
              return post(root + "/auth/passkey/verify-authentication", {
                response: credentialJson(credential),
              });
            })
            .then(function (result) {
              if (!result.ok) {
                say(useNote, "That passkey was not recognised here.", true);
                return;
              }
              say(useNote, "");
              refresh();
            })
            .catch(function (error) {
              say(
                useNote,
                error && error.name === "NotAllowedError"
                  ? ""
                  : "No passkey was offered for this site.",
                true,
              );
            });
        });
      }
    }

    var out = scope.querySelector("[data-account-sign-out]");
    if (out) {
      out.addEventListener("click", function () {
        post(root + "/auth/sign-out", {}).then(function () {
          paint(null);
        });
      });
    }

    refresh();
    drawPasskeys();
    applyProfile(root.replace(/\/api$/, ""));
  }

  /* --- forms the node draws -------------------------------------------------
     A form marked `data-form-fields` has no fields in the markup. It asks the
     node what to show and draws that, which is what lets one contact form ask a
     stranger for their address and a member for nothing: the decision is the
     node's, taken from the session, and the page has no rule of its own to get
     wrong. A designer changes the questions in the panel and this follows. */

  function renderFormFields(content, form) {
    var root = apiRoot(content);
    var slug = form.dataset.form || (get(content, "site.backend") || {}).form;
    if (!root || !slug) return;

    var host = form.querySelector("[data-form-fields]") || form;
    var status = form.querySelector(".notify__status");

    getJson(root + "/public/forms/" + encodeURIComponent(slug))
      .then(function (result) {
        if (!result.ok) {
          if (result.body && result.body.code === "sign_in_required") {
            say(status, "Sign in to use this form.", "error");
            form.hidden = true;
          }
          return;
        }
        var fields = (result.body && result.body.fields) || [];
        host.replaceChildren();
        fields.forEach(function (field) {
          host.appendChild(profileField(field, field.value));
        });
        // Put back after the fields, so the button stays last in the tab order.
        var button = form.querySelector("button[type='submit']");
        if (button && host === form) form.appendChild(button);
        form.dataset.rendered = "1";
      })
      .catch(function () {
        /* leave whatever the markup already had — a form that cannot reach the
           node is better as the plain one than as nothing */
      });
  }

  function applyForms(content) {
    var mailto = get(content, "site.contact.email");

    document.querySelectorAll("[data-form-fields]").forEach(function (host) {
      var form = host.closest("form");
      if (form) renderFormFields(content, form);
    });

    document.querySelectorAll("form[data-form], form.notify").forEach(function (form) {
      var action = submitEndpoint(content, form);
      var success = form.dataset.success || "You are on the list. Watch your inbox.";
      form.addEventListener("submit", function (event) {
        event.preventDefault();

        var status = form.querySelector(".notify__status");
        // Absent on a form the node fills the address into, which is the point
        // of this whole mechanism — so its absence is a shape, not a fault.
        var input = form.querySelector('input[type="email"]:not([disabled])');
        var email = input ? input.value.trim() : "";

        if (input && (!input.checkValidity() || !email)) {
          say(status, "That email address is not complete. Check it and try again.", "error");
          input.focus();
          return;
        }

        // Whatever else the node draws, it still has to be filled in.
        var blank = null;
        form.querySelectorAll("[required]:not([disabled])").forEach(function (node) {
          if (!blank && !String(node.value || "").trim()) blank = node;
        });
        if (blank) {
          say(status, "Something above is still empty.", "error");
          blank.focus();
          return;
        }

        // No form endpoint configured yet: hand the visitor to their mail app
        // rather than silently dropping the address.
        if (!action) {
          if (!isFilled(mailto)) {
            say(status, "The list is not open yet. Try again shortly.", "error");
            return;
          }
          window.location.href =
            "mailto:" +
            mailto +
            "?subject=" +
            encodeURIComponent("Opening notice") +
            "&body=" +
            encodeURIComponent("Please add " + email + " to the list.");
          say(status, "Opening your mail app to finish.");
          return;
        }

        var button = form.querySelector("button[type='submit']");
        button.disabled = true;
        say(status, "Sending…");

        // Sent as FormData on purpose: multipart/form-data is a CORS-safe
        // content type, so the browser skips the preflight round trip that
        // application/json would force on every submission.
        fetch(action, {
          method: "POST",
          headers: { Accept: "application/json" },
          // So the node recognises a signed-in sender and can answer the fields
          // it said it would. A stranger sends no cookie and gets the form they
          // were shown, which is the same request either way.
          credentials: "include",
          body: new FormData(form),
        })
          .then(function (res) {
            return res.json().then(
              function (body) {
                return { ok: res.ok, body: body };
              },
              function () {
                return { ok: res.ok, body: {} };
              }
            );
          })
          .then(function (result) {
            // The backend reports per-field problems rather than a bare failure.
            var fieldError = (result.body.errors || [])[0];
            if (fieldError) {
              say(status, fieldError.message, "error");
              return;
            }
            if (!result.ok || result.body.success === false) {
              say(status, result.body.message || "That did not send. Try again.", "error");
              return;
            }
            form.reset();
            say(status, result.body.message || success);
          })
          .catch(function () {
            say(status, "That did not send. Try again, or email us directly.", "error");
          })
          .finally(function () {
            button.disabled = false;
          });
      });
    });
  }

  function say(node, message, state) {
    if (!node) return;
    node.textContent = message;
    if (state) {
      node.dataset.state = state;
    } else {
      delete node.dataset.state;
    }
  }

  /* --- scroll reveal ------------------------------------------------------ */

  function reveal(nodes) {
    if (
      !("IntersectionObserver" in window) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      nodes.forEach(function (node) {
        node.classList.add("is-revealed");
      });
      return;
    }

    // Anything still unobserved after a beat gets shown anyway, so a card can
    // never be stranded invisible (print, a stalled observer, a headless render).
    var failsafe = setTimeout(function () {
      nodes.forEach(function (node) {
        node.classList.add("is-revealed");
      });
    }, 2500);

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -10%" }
    );

    nodes.forEach(function (node) {
      observer.observe(node);
    });

    window.addEventListener("beforeprint", function () {
      clearTimeout(failsafe);
      nodes.forEach(function (node) {
        node.classList.add("is-revealed");
      });
    });
  }

  /* --- go ----------------------------------------------------------------- */

  // Content files are discovered from the bindings: site and pages always,
  // plus whatever roots the symbols' Content sources name (catalog.items ->
  // catalog.json, craft.steps -> craft.json, …). Adding a source-bound symbol
  // needs no change here.
  fetchJSON("symbols.json").then(function (manifest) {
    var symbolEntries = {};
    var roots = { site: true, pages: true };

    (((manifest || {}).symbols) || []).forEach(function (entry) {
      if (!entry || !entry.id) return;
      symbolEntries[entry.id] = entry;
      if (isFilled(entry.source)) roots[String(entry.source).split(".")[0]] = true;
    });

    var names = Object.keys(roots);
    return Promise.all(
      names.map(function (name) {
        return fetchJSON(name + ".json");
      })
    ).then(function (parts) {
      var content = { symbolEntries: symbolEntries };
      names.forEach(function (name, index) {
        content[name] = parts[index] || {};
      });
      window.PureRender.bindAll(document, content, { asset: asset });
      applyForms(content);
      applyAccounts(content);

      var lots = document.querySelectorAll(".lot");
      lots.forEach(function (node, index) {
        node.style.setProperty("--reveal-delay", index * 70 + "ms");
      });
      reveal(lots);
    });
  });
})();
