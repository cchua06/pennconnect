from taggingTools import ApiTracker, Tagger

from flask import Flask, request, jsonify
from datetime import datetime
import uuid
import boto3
import json
# Import your existing classes and other necessary code here
aws_access_key_id = "AKIASLBAJ5PU4VNS3CEX"
aws_secret_access_key = "2JnRPz01ajY4lK2onXyRB1nX5kMmwNSrPi/dQx7J"


# Initialize a DynamoDB client
dynamodb = boto3.resource('dynamodb',
                          aws_access_key_id=aws_access_key_id,
                          aws_secret_access_key=aws_secret_access_key,
                          region_name='us-east-1')

application = Flask(__name__)

# Initialize your ApiTracker and Tagger here
tracker = ApiTracker()
# Initializing a tagger
tagger = Tagger(tracker, completion_model='gpt-4')

# Adding the "Sender_Origin" tag
tagger.add_tag(
    name="Sender_Origin",
    description="Origin of the email sender",
    question="Who is the origin of the email?",
    responses=['Admin_Communication', 'Academic_Department', 'Student_Organization', 'External_Organization', 'System_Autoresponse', 'Other', 'Unknown/Uncertain'],
    response_guide={
        'Admin_Communication': 'Emails originating from university administrative offices or personnel.',
        'Academic_Department': 'Emails from specific departments.',
        'Student_Organization': 'Emails from recognized student groups, clubs, or organizations.',
        'External_Organization': 'Emails from entities outside the university, such as corporate partners, other institutions, etc.',
        'System_Autoresponse': 'Automated emails from university platforms or services.',
        'Other': "Emails that don't fall into the predefined categories.",
        'Unknown/Uncertain': 'Emails where the origin is unclear or uncertain.'
    },
    parentAttributes=None
)

# Adding the "Purpose" tag
tagger.add_tag(
    name="Purpose",
    description="Primary purpose of the email",
    question="What is the main purpose of the email?",
    responses=['Professional_Event', 'Non_Professional_Event', 'Opportunities', 'General_Update', 'Survey_Request', 'Other', 'Unknown/Uncertain'],
    response_guide={
        'Professional_Event': 'Events oriented towards career development, networking, or specific professions.',
        'Non_Professional_Event': 'More casual events, often for personal growth, hobbies, or leisure.',
        'Opportunities': 'Information about various opportunities. Opportunities can include items ranging from recruitment items to funding opportunities.',
        'General_Update': 'General newsletters, updates, or monthly digests.',
        'Survey_Request': 'Emails requesting participation in a study or feedback.',
        'Other': 'Other purposes not defined.',
        'Unknown/Uncertain': 'When the purpose is unclear or uncertain.'
    },
    parentAttributes=None
)

tagger.add_tag(
    name="Food_Availability",
    description="Indicates if an event offers refreshments.",
    question="Does the event offer any food or refreshments?",
    responses=['Refreshments_Provided', 'No free food', 'Unknown/Uncertain'],
    response_guide={
        'Refreshments_Provided': 'The event offers beverages, snacks, or meals.',
        'No free food': 'No refreshments are offered at the event.',
        'Unknown/Uncertain': "It's unclear whether refreshments are provided or not."
    },
    parentAttributes=[['Purpose','Professional_Event'], ['Purpose','Non_Professional_Event']]
)

# Adding the "Registration_Requirement" tag
tagger.add_tag(
    name="Registration_Requirement",
    description="Requirement for event registration.",
    question="Is registration required for the event?",
    responses=['RSVP_Required', 'Ticket_Purchase_Required', 'Open_Entry', 'Unknown/Uncertain'],
    response_guide={
        'RSVP_Required': 'Advance response is needed to attend the event.',
        'Ticket_Purchase_Required': 'A ticket needs to be bought to attend the event.',
        'Open_Entry': 'No prior requirements to attend the event.',
        'Unknown/Uncertain': 'Unclear if any registration or ticket purchase is needed.'
    },
    parentAttributes=[['Purpose','Professional_Event'], ['Purpose','Non_Professional_Event']]
)

# Adding the "Professional_Event_Type" tag
tagger.add_tag(
    name="Professional_Event_Type",
    description="Type of professional event.",
    question="What type of professional event is it?",
    responses=['Talk', 'Mixer/Social', 'Workshop', 'Panel_Discussion', 'Conference', 'Other', 'Unknown/Uncertain'],
    response_guide={
        'Talk': 'Lectures, presentations, or talks.',
        'Mixer/Social': 'Networking or social events.',
        'Workshop': 'Hands-on sessions or tutorials.',
        'Panel_Discussion': 'Events with multiple speakers discussing a topic.',
        'Conference': 'Large events with multiple sessions.',
        'Other': 'Other types of professional events not specified.',
        'Unknown/Uncertain': 'Unclear about the exact type of the event.'
    },
    parentAttributes=[['Purpose','Professional_Event']]
)

# Adding the "Opportunity_Type" tag
tagger.add_tag(
    name="Opportunity_Type",
    description="Types of opportunities presented.",
    question="What type of opportunity is being presented?",
    responses=['Job', 'Internship', 'Fellowship/Program', 'Competition', 'Other', 'Unknown/Uncertain'],
    response_guide={
        'Job': 'Offers related to full-time or part-time employment.',
        'Internship': 'Temporary positions for students or recent graduates.',
        'Fellowship/Program': 'Specialized academic or professional development programs.',
        'Competition': 'Events where participants compete, like hackathons or contests.',
        'Other': 'Other opportunities not specified above.',
        'Unknown/Uncertain': 'The exact nature of the opportunity is unclear.'
    },
    parentAttributes=[['Purpose','Opportunities']]
)

# Adding the "Opportunity_Location" tag
tagger.add_tag(
    name="Opportunity_Location",
    description="Location or setting of the opportunity.",
    question="Is the opportunity local or global?",
    responses=['Local_Opportunity', 'Global_Opportunity', 'Other', 'Unknown/Uncertain'],
    response_guide={
        'Local_Opportunity': 'Opportunities situated within or very near the university or city.',
        'Global_Opportunity': 'International or opportunities outside the immediate city or state.',
        'Other': "Opportunities that don't clearly fit into local or global.",
        'Unknown/Uncertain': 'Unclear about the exact location or nature of the opportunity.'
    },
    parentAttributes=[['Opportunity_Type','Job'], ['Opportunity_Type','Internship'], ['Opportunity_Type','Fellowship/Program']]
)

# Adding the "Non_Professional_Event_Type" tag
tagger.add_tag(
    name="Non_Professional_Event_Type",
    description="Type of non-professional event.",
    question="What type of non-professional event is it?",
    responses=['Recreational', 'Cultural', 'Community', 'Wellness', 'Other', 'Unknown/Uncertain'],
    response_guide={
        'Recreational': 'Events like campus games, fun fests, or hobby classes.',
        'Cultural': 'Events showcasing art, music, dance, or cultural celebrations.',
        'Community': 'Events focused on community building, awareness campaigns, or social causes.',
        'Wellness': 'Events or sessions centered around mental health, physical health, or general well-being.',
        'Other': 'Other types of non-professional events not specified.',
        'Unknown/Uncertain': 'Unclear about the exact type of the event.'
    },
    parentAttributes=[['Purpose','Non_Professional_Event']]
)

tagger.add_tag(
    name="School_Interest",
    description="Identifies which Penn school(s) might be interested in the email.",
    question="Which Penn school(s) is this email most relevant to?",
    responses=['Arts_and_Sciences', 'SEAS', 'Nursing', 'Wharton', 'Multiple_Schools', 'All_Schools', 'Unknown/Uncertain'],
    response_guide={
        'Arts_and_Sciences': 'Relevant to the School of Arts and Sciences.',
        'SEAS': 'Relevant to the School of Engineering and Applied Science.',
        'Nursing': 'Relevant to the School of Nursing.',
        'Wharton': 'Relevant to the Wharton School.',
        'Multiple_Schools': 'Relevant to more than one Penn school.',
        'All_Schools': 'Relevant to all Penn schools.',
        'Unknown/Uncertain': 'Unclear which school(s) the email is relevant to.'
    },
    parentAttributes=None
)

tagger.add_tag(
    name="SAS_Major_Interest",
    description="Relevant majors in the School of Arts and Sciences.",
    question="Which majors in the School of Arts and Sciences might be interested in this email?",
    responses=['Humanities', 'Social_Sciences', 'Natural_Sciences', 'Interdisciplinary', 'Cultural_Studies', 'Other', 'Unknown/Uncertain'],
    response_guide={
        'Humanities': 'Relevant to humanities majors.',
        'Social_Sciences': 'Relevant to social science majors.',
        'Natural_Sciences': 'Relevant to natural science majors.',
        'Interdisciplinary': 'Relevant to interdisciplinary majors.',
        'Cultural_Studies': 'Relevant to cultural studies majors.',
        'Other': 'Relevant to other majors not listed.',
        'Unknown/Uncertain': 'Unclear which majors the email is relevant to.'
    },
    parentAttributes=[['School_Interest', 'Arts_and_Sciences']]
)


tagger.add_tag(
    name="SEAS_Major_Interest",
    description="Relevant majors in the School of Engineering and Applied Science.",
    question="Which majors in SEAS might be interested in this email?",
    responses=['Bioengineering', 'Computer_Science_and_Engineering', 'Electrical_Engineering', 'Mechanical_Engineering', 'Chemical_Engineering', 'Other', 'Unknown/Uncertain'],
    response_guide={
        'Bioengineering': 'Relevant to Bioengineering majors.',
        'Computer_Science_and_Engineering': 'Relevant to Computer Science and Engineering majors.',
        'Electrical_Engineering': 'Relevant to Electrical Engineering majors.',
        'Mechanical_Engineering': 'Relevant to Mechanical Engineering and Applied Mechanics majors.',
        'Chemical_Engineering': 'Relevant to Chemical and Biomolecular Engineering majors.',
        'Other': 'Relevant to other SEAS majors not listed.',
        'Unknown/Uncertain': 'Unclear which majors the email is relevant to.'
    },
    parentAttributes=[['School_Interest', 'SEAS']]
)


tagger.add_tag(
    name="Nursing_Major_Interest",
    description="Relevant majors in the School of Nursing.",
    question="Which majors in the School of Nursing might be interested in this email?",
    responses=['Nursing', 'Nutrition_Science', 'Other', 'Unknown/Uncertain'],
    response_guide={
        'Nursing': 'Relevant to Nursing majors.',
        'Nutrition_Science': 'Relevant to Nutrition Science majors.',
        'Other': 'Relevant to other Nursing school majors not listed.',
        'Unknown/Uncertain': 'Unclear which majors the email is relevant to.'
    },
    parentAttributes=[['School_Interest', 'Nursing']]
)


tagger.add_tag(
    name="Wharton_Major_Interest",
    description="Relevant majors in the Wharton School.",
    question="Which majors in the Wharton School might be interested in this email?",
    responses=['Finance_and_Accounting', 'Marketing_and_Communication', 'Management_and_Legal_Studies', 'Business_Analytics_and_Operations', 'Health_Care_Management', 'Environmental_and_Social_Governance', 'Individualized', 'Other', 'Unknown/Uncertain'],
    response_guide={
        'Finance_and_Accounting': 'Relevant to Finance and Accounting majors.',
        'Marketing_and_Communication': 'Relevant to Marketing and Communication majors.',
        'Management_and_Legal_Studies': 'Relevant to Management and Legal Studies majors.',
        'Business_Analytics_and_Operations': 'Relevant to Business Analytics and Operations majors.',
        'Health_Care_Management': 'Relevant to Health Care Management majors.',
        'Environmental_and_Social_Governance': 'Relevant to Environmental, Social, and Governance majors.',
        'Individualized': 'Relevant to Individualized majors.',
        'Other': 'Relevant to other Wharton majors not listed.',
        'Unknown/Uncertain': 'Unclear which majors the email is relevant to.'
    },
    parentAttributes=[['School_Interest', 'Wharton']]
)


@application.route('/')
def hello_world():
    return 'Hello, World!'

@application.route('/process_text', methods=['POST'])
def process_text():
    try:
        data = request.json
        text = data['text']

        # Split the text into announcements if needed
        announcements = tagger.split_announcements(text)

        # Tag each announcement
        results = []
        for announcement in announcements:
            tags = tagger.tagText(announcement)
            results.append({'announcement': announcement, 'tags': tags})

        return jsonify(results)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@application.route('/log_announcement', methods=['POST'])
def log_announcement():
    try:
        data = request.json
        text = data['text']
        announcement_title = data.get('announcementTitle', 'Default Title')  # Default title if not provided
        user_created = data.get('userCreated', 'Unknown User')  # Default user if not provided

        # Split the text into announcements if needed
        announcements = tagger.split_announcements(text)

        # Initialize a list to store response for each announcement
        response = []

        # Get current datetime
        current_datetime = datetime.now().strftime("%d/%m/%Y, %I:%M%p")

        # Process each announcement
        for announcement in announcements:
            tags = tagger.tagText(announcement)
            announcement_id = str(uuid.uuid4())

            # Get the DynamoDB table
            table = dynamodb.Table('announcements')

            # Store the announcement and its tags in DynamoDB
            table.put_item(
                Item={
                    'announcementId': announcement_id,
                    'announcementTitle': announcement_title,
                    'userCreated': user_created,
                    'contents': announcement,
                    'announcementDateTime': current_datetime,
                    'tags': json.dumps(tags)  # Serialize tags if they are not a simple dictionary
                }
            )

            # Add the processed announcement to the response
            response.append({
                'announcementId': announcement_id,
                'announcementTitle': announcement_title,
                'userCreated': user_created,
                'contents': announcement,
                'announcementDateTime': current_datetime,
                'tags': tags
            })

        return jsonify(response), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@application.route('/create_algorithm', methods=['POST'])
def create_algorithm():
    data = request.json
    algorithm_id = str(uuid.uuid4())
    goal_description = data['goal']
    # Assuming you have a method in your Tagger class to generate an algorithm
    algorithm = tagger.create_tagging_algorithm(goal_description)

    table = dynamodb.Table('algorithms')
    table.put_item(
        Item={
            'algorithmId': algorithm_id,
            'goal_description': goal_description,
            'algorithm_object': json.dumps(algorithm)  # Serialize the algorithm object
        }
    )
    return jsonify({'algorithmId': algorithm_id}), 200


@application.route('/get_score', methods=['POST'])
def get_score():
    try:
        data = request.json
        announcement_id = data['announcement_id']
        algorithm_id = data['algorithm_id']

        # Fetch announcement and algorithm from DynamoDB
        announcements_table = dynamodb.Table('announcements')
        algorithms_table = dynamodb.Table('algorithms')

        announcement_response = announcements_table.get_item(Key={'announcementId': announcement_id})
        algorithm_response = algorithms_table.get_item(Key={'algorithmId': algorithm_id})

        # Ensure the items exist
        if 'Item' not in announcement_response or 'Item' not in algorithm_response:
            return jsonify({'error': 'Announcement or Algorithm not found'}), 404

        announcement = announcement_response['Item']
        algorithm = algorithm_response['Item']

        # Deserialize the data
        tags = json.loads(announcement['tags'])
        algorithm_object = json.loads(algorithm['algorithm_object'])

        # Calculate the score
        score = tagger.get_announcement_score(tags, algorithm_object)
        return jsonify({'score': score}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    application.run(debug=True)