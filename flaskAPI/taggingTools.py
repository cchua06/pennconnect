import pandas as pd
import numpy as np
import ast

import random
random.seed(42)
import pandas as pd
import numpy as np
import json
import openai
import os
from tenacity import retry, stop_after_attempt, wait_random_exponential, retry_if_exception_type
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor


openai.organization = "org-bgAXfs8WdU5942SLngg0OGpd"
openai.api_key = "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"
os.environ['OPENAI_API_KEY']=openai.api_key



from transformers import GPT2Tokenizer

class ApiTracker:
    def __init__(self):
        self.alertIncrements = 20
        self.totalCost = 0
        self.totalDavinciTokens = 0
        self.totalCurieTokens = 0
        self.totalGpt3TurboTokens = 0
        self.totalGpt3Turbo16kTokens = 0
        self.totalGpt4Tokens = 0
        self.alertCounter = 0
        self.prompt_generations_log = []
        self.tokenizer = GPT2Tokenizer.from_pretrained('gpt2')

    def enumerate_requests(self, limitLength, lastX):
        for i, (x, y) in enumerate(self.prompt_generations_log[-lastX:]):
            print("---")
            print("{} : {}, {}".format(i, x, self.count_gpt2_tokens(y)))
            print(y[:limitLength])

    def check_alert_increment(self):
        if self.totalCost >= (self.alertCounter + 1) * self.alertIncrements:
            self.alertCounter += 1
            print("=======================================")
            print("=======================================")
            print(f"Alert: Total cost has reached ${self.alertCounter * self.alertIncrements:.2f}")
            print("=======================================")
            print("=======================================")

    def count_gpt2_tokens(self, text):
        tokens = self.tokenizer.tokenize(text)
        return len(tokens)

    def accountingCost(self, prompt, generation, model):
        costPerTokenDavinci = 0.02/1000
        costPerTokenCurie = 0.002/1000
        costPerTokenGpt3TurboPrompt16k = 0.003/1000
        costPerTokenGpt3TurboCompletion16k = 0.004/1000
        costPerTokenGpt3TurboPrompt = 0.0015/1000
        costPerTokenGpt3TurboCompletion = 0.002/1000
        costPerTokenGpt4Prompt = 0.03/1000
        costPerTokenGpt4Generation = 0.06/1000

        promptTokens = self.count_gpt2_tokens(prompt)
        genTokens = self.count_gpt2_tokens(generation)
        numTokens = promptTokens + genTokens
        if "curie" in model:
            self.totalCurieTokens += numTokens
            cost = costPerTokenCurie * numTokens
        elif "davinci" in model:
            self.totalDavinciTokens += numTokens
            cost = costPerTokenDavinci * numTokens
        elif "3.5-turbo" in model:
            if "16k" in model:
                self.totalGpt3Turbo16kTokens += numTokens
                cost = costPerTokenGpt3TurboPrompt16k * promptTokens
                cost += costPerTokenGpt3TurboCompletion16k * genTokens
            else:
                self.totalGpt3TurboTokens += numTokens
                cost = costPerTokenGpt3TurboPrompt * promptTokens
                cost += costPerTokenGpt3TurboCompletion * genTokens
        elif "gpt-4" in model:
            self.totalGpt4Tokens += numTokens
            cost = costPerTokenGpt4Prompt * promptTokens
            cost += costPerTokenGpt4Generation * genTokens

        self.totalCost += cost
        self.prompt_generations_log.append((cost, prompt + generation))

        self.check_alert_increment()

    @retry(wait=wait_random_exponential(min=1, max=60), stop=stop_after_attempt(100), retry=(retry_if_exception_type(openai.error.RateLimitError) | retry_if_exception_type(openai.error.APIError) | retry_if_exception_type(openai.error.ServiceUnavailableError) | retry_if_exception_type(openai.error.APIConnectionError)))
    def completion(self, model, temp, prompt, stopToken="###", maxtokens=200, format="completion"):
        # If the format is "completion"
        if format == "completion":
            response = openai.Completion.create(
                engine=model,
                prompt=prompt,
                max_tokens=maxtokens,
                stop=[stopToken],
                temperature=temp
            )
            generated_text = response['choices'][0]['text']
        # If the format is "chat"
        elif format == "chat":
            # Construct the messages list for the chat format
            messages = [
                {"role": "system", "content": "You are an expert data annotator"},
                {"role": "user", "content": prompt}
            ]

            response = openai.ChatCompletion.create(
                model=model,
                messages=messages,
                max_tokens=maxtokens,
                stop=[stopToken],
                temperature=temp
            )
            generated_text = response['choices'][0]['message']['content']
        else:
            raise ValueError("Unsupported format. Please use either 'completion' or 'chat'.")

        self.accountingCost(prompt, generated_text, model)
        return generated_text


    @retry(wait=wait_random_exponential(min=1, max=60), stop=stop_after_attempt(10), retry=(retry_if_exception_type(openai.error.RateLimitError) | retry_if_exception_type(openai.error.APIError)))
    def call_api(self, model, chunk, stopTokens, temp, max_tokens):
        response = openai.Completion.create(
            model=model,
            prompt=chunk,
            max_tokens=max_tokens,
            stop=stopTokens,
            temperature=temp
        )
        # Call accountingCost for each prompt and generated text
        for choice in response.choices:
            self.accountingCost(chunk[choice.index], choice.text, model)
        return response

    @retry(wait=wait_random_exponential(min=1, max=60), stop=stop_after_attempt(10), retry=(retry_if_exception_type(openai.error.RateLimitError) | retry_if_exception_type(openai.error.APIError)))
    def batchCompletion(self, batchSizes, model, temp, prompts, stopTokens=["###"], waitTime=30, tokenLimit=1000):
        results = []
        listPrompts = list(prompts)
        for i in tqdm(range(0, len(prompts), batchSizes)):
            #time.sleep(waitTime)
            chunk = listPrompts[i:i + batchSizes]
            # batching
            responses = [("","")] * len(chunk)
            try:
              response = self.call_api(
                  model=model,
                  chunk=chunk,
                  stopTokens=stopTokens,
                  temp=temp,
                  max_tokens=tokenLimit
              )

              # match completions to prompts by index
              for choice in response.choices:
                  responses[choice.index] = (chunk[choice.index], choice.text)
            except openai.error.InvalidRequestError:
              print("batch prompting length error")
            results.extend(responses)
        return results
    

class Tagger:
    def __init__(self, tracker, completion_model='gpt-4'):
        self.tracker = tracker
        self.tags = []
        self.tagDag = {}
        self.completion_model = completion_model

    def add_tag(self, name, description, question, responses, response_guide, parentAttributes=None):
        newTag = {
            'name': name,
            'description': description,
            'question': question,
            'responses': responses,
            'response_guide': response_guide,
            'parentAttributes': parentAttributes
        }
        self.tags.append(newTag)

        # Update the tagDag
        if not parentAttributes:
            self.tagDag[name] = []
        else:
            for parentTag, _ in parentAttributes:
                if parentTag in self.tagDag:
                    self.tagDag[parentTag].append(name)
                else:
                    self.tagDag[parentTag] = [name]


    def tagText(self, text):
      applied_tags = []
      evaluated_tags = set()  # Keep track of tags that have already been evaluated

      def apply_tag(name, text):
          if name in evaluated_tags:  # Skip tags that have already been evaluated
              return
          evaluated_tags.add(name)

          for tag in self.tags:
              if tag['name'] == name:
                  response = self.answer_question(text, tag)
                  print(f"DEBUG: Evaluating tag '{name}' with question '{tag['question']}' resulted in response '{response}'")  # Debug output
                  if response:
                      applied_tags.append((name, response))

                      # If current tag's response is part of the parent attributes for any child tag, apply child tag
                      for child_tag in self.tagDag.get(name, []):
                          child_tag_info = next((t for t in self.tags if t['name'] == child_tag), None)
                          if child_tag_info and child_tag_info['parentAttributes']:
                              for parent, req_resp in child_tag_info['parentAttributes']:
                                  if parent == name and response == req_resp:
                                      apply_tag(child_tag, text)
                                      break

      root_tags = [name for name, children in self.tagDag.items() if not any(name in child for child in self.tagDag.values())]
      for root in root_tags:
          apply_tag(root, text)

      return applied_tags



    def measure_tag_prompt(self,tag,text):
      """
      Generates the prompt for measuring a concept.

      Args:
      concept (dict): Concept to measure.
      text (str): Text to measure the concept on.

      Returns:
      prompt (str): Generated prompt.
      """
      # The method first formats the tag and text into a string,
      # and then returns the string as the prompt for measuring the concept.
      tagString = str({k: tag[k] for k in ('name', 'description', 'question', 'response_guide')})

      prompt = """Answer the following question about the text below by selecting from the following choices. Before answering the question, extract any potentially relevant snippets of the text that can serve as evidence for each classification. After that, compare the snippets against the response guide to come up with a final decision.

Format your response as a JSON with string keys and string values. Below is an example of a valid JSON response. The JSON contains keys for snippets, thoughts, and answer. End your response with ###
---
Text: Text
Response JSON:{{"snippets": {{
"classification 1" : ["Snippet 1", "Snippet 2", ...],
"classification 2" : ["Snippet 3", "Snippet 4", ...]
...
}},
"thoughts": "In this section, you weigh evidence based on the text and the extracted snippets to come to a final decision with the response guide as a reference. Be as objective as possible and ignore irrelevant information. Focus only on the snippets and avoid making guesses.",
"answer": "An answer from the response guide goes here. In answering the question, ignore irrelevant information and avoid making assumptions."}}###
---
An example of this task being performed can be seen below. Note that the snippet should be as short as possible and be no greater than 10 words.

Concept:
{{
"Concept Name": "good build quality",
"Concept Description": "build quality refers to the craftsmanship, durability, and overall construction of a product. It encompasses aspects such as materials used, design, manufacturing techniques, and attention to detail. A product with good build quality is typically considered to be well-made, sturdy, and long-lasting, while a product with poor build quality may be prone to defects or wear out quickly.",
"Concept Question": "What does the review say about the build quality of the product?",
"Possible Responses": ["high", "low", "uncertain", "not applicable"],
"Response Guide": {{
"high": "Review mentions aspects such as well-made, sturdy, durable, high-quality materials, excellent craftsmanship, etc.",
"low": "Review mentions aspects such as poor construction, flimsy, cheap materials, bad design, easily breakable, etc.",
"uncertain": "Review does not mention build quality, the information is ambiguous or vague, or it has both positive and negative aspects mentioned like 'the product is sturdy but uses cheap materials'.",
"not applicable": "The review does not mention the build quality of the product at all."
}}
}}

Text: "This product has a great design and is really easy to use. It is also very durable."
Response JSON:{{"snippets":{{
"high": ["It is also very durable", "really easy to use"],
"low": [],
"uncertain": []
}},
"thoughts": "Two snippets for high. The first is related to durability which is an aspect of good build quality. The second is related to ease of use which is not related to good build quality. Overall the text describes good build quality.",
"answer": "positive"
}}###
---
Text: "Was excited for it to finally arrive, got here in nice sturdy packaging. Opened it up though and it smelled kind of weird? goes away after a while but otherwise an ok product. Saw some print aberrations it didn't interfere much with use."
Response JSON:{{"snippets":{{
"high": ["got here in nice sturdy packaging"],
"low": ["Saw some print aberrations"],
"uncertain": []
}},
"thoughts": "One snippet for high, one snippet for low. The low snippet comes with a caveat that it 'didn't interfere much with use'. In the positive snippet, 'Sturdy' only refers to the packaging, not the product. We do not have strong enough evidence for a high classification.",
"answer": "low"
}}###
---
Text: "A big fan of the product. Serves me well during workouts but I go through them like hotcakes. Don't expect it to last long compared to other brands but you get what you pay for. It does the job though."
Response JSON:{{"snippets":
{{
"high": ["Serves me well during workouts"],
"low": ["Don't expect it to last long compared to other brands", "I go through them like hotcakes"],
"uncertain": ["you get what you pay for"]
}},
"thoughts": "One high snippet, two low snippets, one uncertain snippet. The high snippet is about utility which is not related to build quality. The first and second low snippet relates to durability, an aspect of build quality.",
"answer": "negative"
}}###
---
Text: "Very disappointing. I was excited to order this but when it arrived I was shocked at how poorly it worked. Deceptive advertising at its finest."
Response JSON:{{"snippets": {{
"high": [],
"low": ["Very disappointing", "shocked at how poorly it worked", "Deceptive advertising"],
"uncertain": []
}},
"thoughts": "Three low spans. The first is related to overall judgment which is irrelevant, the second is related to functionality which is irrelevant, and the third is related to marketing/advertising which is also irrelevant. None are related to build quality.",
"answer": "not applicable"
}}###
---
Perform the task below, keeping in mind to limit snippets to 10 words and ignoring irrelevant information. Return a valid JSON response ending with ###
Concept: {}

Text: {}
Response JSON:""".format(tagString, text)

      return prompt

    def answer_extractor(self, responseText, nullable = False):
        """
        Extracts the answer from the response of the OpenAI API.

        Args:
        responseText (str): Response from the OpenAI API.
        nullable (bool, optional): Whether to return None for invalid responses. Defaults to False.

        Returns:
        tuple: Extracted answer, score, snippets, and thoughts.
        """
        # The method first cleans the response text and parses it into a JSON object.
        # It then extracts the answer, score, snippets,
        # and thoughts from the JSON object and returns them as a tuple.
        try:
            cleanedResponse = responseText.replace("\n", "").replace("“", "\"").replace("”", "\"")
            jsonResponse = json.loads(cleanedResponse)
            for item in ['snippets', 'thoughts','answer']:
              if item not in jsonResponse.keys():
                return ("na", cleanedResponse, 'Invalid JSON response generated - missing keys')
            answer = jsonResponse['answer']
            return (answer, jsonResponse['snippets'], jsonResponse['thoughts'])
        except json.JSONDecodeError:
            if nullable:
              score = None
            else:
              score = 0
            return ("na", cleanedResponse, 'Invalid JSON response generated')

    def answer_question(self, text, tag):
        prompt = self.measure_tag_prompt(tag, text)
        LLMResponse = self.tracker.completion(self.completion_model, 0, prompt, maxtokens=200, format="chat")
        answer = self.answer_extractor(LLMResponse)[0]
        return answer

    def json_response_extractor(self, text):
      try:
          cleanedResponse = text.replace("\n", "").replace("“", "\"").replace("”", "\"")
          jsonResponse = json.loads(cleanedResponse)
          return jsonResponse
      except json.JSONDecodeError:
          print("Invalid JSON:" + text)

    def tag_goal_value(self, goal, tags):
      #Takes in a goal and a set of tags.
      #Iterate through set of tags and classifies each (tag,value) pair as either "boost", "ignore", or "filter"
      promptFn = lambda tag: f"""
Your task is to act as a content recommendation algorithm. You will be provided a user goal, and a tag. Information associated with each tag include that tag's name, the tag description, tag question, tag responses, and the response guide.
For each tag, your task is to identify how the recommendation algorithm should classify posts that fall under each tag value.

Some examples of the task being performed are shown below

---
Goal Description: The user wants to filter out all automated system emails
Tag:
{{
"name": "Sender_Origin",
"description": "Origin of the email sender",
"question"': "Who is the origin of the email?",
Responses: ["Admin_Communication", "Academic_Department", "Student_Organization", "External_Organization", "System_Autoresponse", "Other", "Unknown/Uncertain"]
Response Guide: {{
  "Admin_Communication": "Emails originating from university administrative offices or personnel.",
  "Academic_Department": "Emails from specific departments.",
  "Student_Organization": "Emails from recognized student groups, clubs, or organizations.",
  "External_Organization": "Emails from entities outside the university, such as corporate partners, other institutions, etc.",
  "System_Autoresponse": "Automated emails from university platforms or services.",
  "Other": "Emails that don't fall into the predefined categories.",
  "Unknown/Uncertain": "Emails where the origin is unclear or uncertain".
}}
Response: {{
"Reasoning" : {{
  "Admin_Communication": "Allowing emails from admin communications does not interfere with the goal. Ignore",
  "Academic_Department": "Allowing emails from admin communications does not interfere with the goal. Ignore",
  "Student_Organization": "Allowing emails from admin communications does not interfere with the goal. Ignore",
  "External_Organization": "Allowing emails from admin communications does not interfere with the goal. Ignore",
  "System_Autoresponse": "This is an automated system email. We filter these out.",
  "Other": "This provides no evidence of the origin is automated. Ignore.",
  "Unknown/Uncertain": "This provides no information if the origin is automated. Ignore."
}},
"Result" : {{
  "Boost" : [],
  "Ignore": ["Admin_Communication", "Academic_Department", "Student_Organization", "External_Organization", "Other", "Unknown/Uncertain"],
  "Filter": ["System_Autoresponse"]
}}
}}

Goal Description: The user wants to look for fun events
Tag:
{{
"name": "Sender_Origin",
"description": "Origin of the email sender",
"question"': "Who is the origin of the email?",
Responses: ["Admin_Communication", "Academic_Department", "Student_Organization", "External_Organization", "System_Autoresponse", "Other", "Unknown/Uncertain"]
Response Guide: {{
  "Admin_Communication": "Emails originating from university administrative offices or personnel.",
  "Academic_Department": "Emails from specific departments.",
  "Student_Organization": "Emails from recognized student groups, clubs, or organizations.",
  "External_Organization": "Emails from entities outside the university, such as corporate partners, other institutions, etc.",
  "System_Autoresponse": "Automated emails from university platforms or services.",
  "Other": "Emails that don't fall into the predefined categories.",
  "Unknown/Uncertain": "Emails where the origin is unclear or uncertain".
}}
Response: {{
"Reasoning" : {{
  "Admin_Communication": "Admin communications can contain fun events but not necessarily. Ignore.",
  "Academic_Department": "Admin communications can contain fun events but not necessarily. Ignore.",
  "Student_Organization": "Emails from student organizations are more likely to contain fun events. Boost.",
  "External_Organization": "Emails from external organizations can be fun, but there are many kinds of external organizations. Ignore.",
  "System_Autoresponse": "These emails are unlikely about to be fun events but it is still possible. Ignore.",
  "Other": "This provides no evidence if the text is a fun event. Ignore.",
  "Unknown/Uncertain": This provides no information if the origin is a fun event. Ignore."
}},
"Result" : {{
  "Boost" : ["Student_Organization"],
  "Ignore": ["Admin_Communication", "Academic_Department", "External_Organization", "Other", "Unknown/Uncertain"],
  "Filter": []
}}
}}
---

Below we perform the task with the given goal description and tag. Format your response as a valid JSON with the keys "Reasoning" and "Result" similar to the examples above.
Goal Description: {goal}
Tag: {tag}
Response:
"""
      prompts = [promptFn(tag) for tag in tags]
      with ThreadPoolExecutor(max_workers=10) as executor:  # max_workers determines how many threads will be spawned
          responses = list(tqdm(executor.map(lambda p: self.tracker.completion(self.completion_model, 0, p, stopToken="###", maxtokens=1000, format="chat"), prompts), total=len(prompts)))
      answers = [self.json_response_extractor(resp) for resp in responses]
      return zip(tags, answers)

    def score_tag_value_pair(self, goal, tag, tagValue):
      #Takes in a goal and a set of tags.
      #Iterate through set of tags and classifies each (tag,value) pair as either "boost", "ignore", or "filter"
      prompt = f"""
Your task is to act as a content recommendation algorithm. You will be provided a user goal, and a tag. Information associated with each tag include that tag's name, the tag description, tag question, tag responses, and the response guide.
For each tag, your task is to identify how the recommendation algorithm should prioritize tag values. We can assign the following values:

1 - We assign a score of 1 if a post containing that tag-value pair is *irrelevant* for a user's goal
3 - We assign a score of 3 if a post containing that tag-value pair is *potentially relevant* for a user's goal
5 - We assign a score of 5 if a post containing that tag-value pair is *definitely relevant* for a user's goal
10 - We assign a score of 10 if a post containing that tag-value pair is *highly relevant* for a user's goal

Some examples of the task being performed are shown below. Your response should be formatted as a JSON following the format below
Response : {{
  "Reasoning": "String reasoning through how to score posts with the tag value being considered",
  "Score": Any of 1,3,5, or 10
}}

---

Goal Description: The user wants to look for outside internships
Tag:
{{
"name": "Sender_Origin",
"description": "Origin of the email sender",
"question"': "Who is the origin of the email?",
Responses: ["Admin_Communication", "Academic_Department", "Student_Organization", "External_Organization", "System_Autoresponse", "Other", "Unknown/Uncertain"]
Response Guide: {{
  "Admin_Communication": "Emails originating from university administrative offices or personnel.",
  "Academic_Department": "Emails from specific departments.",
  "Student_Organization": "Emails from recognized student groups, clubs, or organizations.",
  "External_Organization": "Emails from entities outside the university, such as corporate partners, other institutions, etc.",
  "System_Autoresponse": "Automated emails from university platforms or services.",
  "Other": "Emails that don't fall into the predefined categories.",
  "Unknown/Uncertain": "Emails where the origin is unclear or uncertain".
}}
Tag value being considered: Student_Organization
Response: {{
"Reasoning" : "The user is looking for outside internships, emails from Student Organizations might include opportunities from outside Penn. Emails with this tag may be potentially relevant.",
"Score" : 3
}}

Goal Description: The user wants to look for outside internships
Tag:
{{
"name": "Sender_Origin",
"description": "Origin of the email sender",
"question"': "Who is the origin of the email?",
Responses: ["Admin_Communication", "Academic_Department", "Student_Organization", "External_Organization", "System_Autoresponse", "Other", "Unknown/Uncertain"]
Response Guide: {{
  "Admin_Communication": "Emails originating from university administrative offices or personnel.",
  "Academic_Department": "Emails from specific departments.",
  "Student_Organization": "Emails from recognized student groups, clubs, or organizations.",
  "External_Organization": "Emails from entities outside the university, such as corporate partners, other institutions, etc.",
  "System_Autoresponse": "Automated emails from university platforms or services.",
  "Other": "Emails that don't fall into the predefined categories.",
  "Unknown/Uncertain": "Emails where the origin is unclear or uncertain".
}}
Tag value being considered: External_Organization
Response: {{
"Reasoning" : "The user is looking for outside internships, emails from External organizations should be prioritized above all other types of responses. Emails with this tag may be Highly relevant.",
"Score" : 10
}}



---


Below we perform the task with the given goal description and tag. Format your response as a valid JSON with the keys "Reasoning" and "Result" similar to the examples above.
Goal Description: {goal}
Tag: {tag}
Tag value being considered: {tagValue}
Response:"""
      response = self.tracker.completion(self.completion_model, 0, prompt, stopToken="###", maxtokens=1000, format="chat")
      responseJson = self.json_response_extractor(response)
      print("DEBUG: " + str(responseJson))
      score = responseJson.get('Score', 0)
      return score


    def tag_goal_rankings(self, goal, processed_tags):
      #return list of tags sorted according to the goal
      boostRankings = []
      filterTags = []
      for tag, result in tqdm(processed_tags):
        for item in result['Result']['Boost']:
          score = self.score_tag_value_pair(goal, tag, item)
          boostRankings.append(((tag['name'], item), score))
        for item in result['Result']['Filter']:
          boostRankings.append((tag['name'], item))

      return boostRankings,filterTags

    def create_tagging_algorithm(self, goal):
      #Iterate through all the tags.
      #For each tag, call the tag goal value
      #After getting all tag goal values, call tag goal rankings
      #Return tuple of (necessary tags, filter tags)
      tag_goal_values = self.tag_goal_value(goal, self.tags)
      tag_rankings = self.tag_goal_rankings(goal, tag_goal_values)
      return tag_rankings

    def get_announcement_score(self, textTags, taggingAlgorithm):
      # Check if any of the textTags are in filterTags
      boostRankings, filterTags = taggingAlgorithm
      print(textTags)
      print(boostRankings)
      for tag in textTags:
          if tag in filterTags:
              return -1

      # Compute the score based on boostRankings
      score = 0
      for tag in textTags:
          for boostTag, ranking in boostRankings:
              print(tag, boostTag, ranking)
              if tag == boostTag:
                  score += ranking

      return score

    def split_announcements(self, text):
      prompt = f"""Your task is to split the text below into sub-messages. Format your response as a list.
The task format is as follows:

Text: LONG MESSAGE
Response: [message 1, message 2, ...]


Example:
---
Text: Digest for the the week of November 13: Join the CIS Department this Friday for our annual Mixer on 'Quantum Computing Advancements'. PS: Snacks and beverages will be provided! Sign up on tinyurl.com/QuantumRegistration! Hi all! This is Brenda from the Frisbee club. We'll be having our meet this saturday 5pm. Please sign up on the sheet and pay the registration fee so that we can sort the teams out before starting. Message from the DATS Department: Professor Smith is looking for teaching assistants for their fall course for databases. Interested applicants can reach out to smith@seas.upenn.edu with their resume to apply.
Response: ["Digest for the the week of November 13: Join the CIS Department this Friday for our annual Mixer on 'Quantum Computing Advancements'. PS: Snacks and beverages will be provided! Sign up on tinyurl.com/QuantumRegistration!",
"Hi all! This is Brenda from the Frisbee club. We'll be having our meet this saturday 5pm. Please sign up on the sheet and pay the registration fee so that we can sort the teams out before starting.",
"Message from the DATS Department: Professor Smith is looking for teaching assistants for their fall course for databases. Interested applicants can reach out to smith@seas.upenn.edu with their resume to apply."]
---


Text: {text}
Response:"""
      LLMResponse = self.tracker.completion(self.completion_model, 0, prompt, maxtokens=2000, format="chat")
      splitAnnouncements = ast.literal_eval(LLMResponse)
      return splitAnnouncements